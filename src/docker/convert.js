const AWS = require('aws-sdk')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Required environment variables:
 *
 * - OUTPUT_BUCKET - The name of the output bucket.
 * - SNS_TOPIC - The ARN for the SNS topic to send notifications to.
 * - INPUT_SOURCE_KEY - The key of the object we are transcoding.
 * - INPUT_BUCKET - The name of the bucket the object is coming from.
 */

const FFMPEG_PATH = '/usr/local/bin/ffmpeg'
const FFPROBE_PATH = '/usr/local/bin/ffprobe'
const s3 = new AWS.S3()
const sns = new AWS.SNS()
const outputBucket = process.env.OUTPUT_BUCKET
const snsTopic = process.env.SNS_TOPIC

const STATUSES = {
  PROCESSING: 'PROCESSING',
  ERROR: 'ERROR',
  COMPLETE: 'COMPLETE'
}

const reportStatusUpdate = async (bucket, key, status, detail) => {
  const payload = { bucket, key, status, detail }
  console.info('reporting status update', payload)
  try {
    await sns.publish({
      Message: JSON.stringify(payload),
      TopicArn: snsTopic
    }).promise()
  } catch (err) {
    console.error('error reporting status update')
    console.error(err)
    throw err
  }
  console.info('reported')
}

const downloadFile = (bucket, srcKey, resultPath) => {
  return new Promise((resolve, reject) => {
    console.info('downloading from bucket %s and key %s', bucket, srcKey)
    const file = fs.createWriteStream(resultPath)
    s3.getObject({
      Bucket: bucket,
      Key: srcKey
    }).createReadStream().on('error', err => {
      console.error('error writing to result file')
      console.error(err)
      reject(new Error('error writing to result file'))
    }).pipe(file).on('close', () => {
      console.info('file written successfully')
      resolve()
    })
  })
}

const getFileDuration = (filename) => {
  console.info('getting file duration of %s', filename)
  const ffprobe = spawnSync(FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    filename
  ])
  console.info('ffprobe result', ffprobe)
  console.info('stdout', ffprobe.stdout.toString())
  console.info('stderr', ffprobe.stderr.toString())
  if (ffprobe.status !== 0) {
    console.error('ffprobe failed')
    console.error(ffprobe.stderr.toString())
    throw new Error(`ffprobe error: ${ffprobe.stderr.toString()}`)
  }
  return Math.ceil(parseFloat(ffprobe.stdout.toString().trim()))
}

const convertAudio = (bucket, srcKey) => {
  return new Promise((resolve, reject) => {
    const targetKey = srcKey.replace('.webm', '.mp3')
    const sourceFilename = path.join(os.tmpdir(), path.basename(srcKey))
    const targetFilename = path.join(os.tmpdir(), path.basename(targetKey))
    const cleanFiles = () => {
      try {
        fs.unlinkSync(sourceFilename)
        fs.unlinkSync(targetFilename)
      } catch (err) {
        console.error('error cleaning files')
        console.error(err)
      }
    }
    console.info('downloading webm source to', sourceFilename)
    downloadFile(bucket, srcKey, sourceFilename).then(() => {
      const ffmpeg = spawn(FFMPEG_PATH, [
        '-i',
        sourceFilename,
        '-vn',
        '-ab',
        '128k',
        '-ar',
        '44100',
        '-y',
        targetFilename
      ], {
        stdio: 'inherit'
      })
      ffmpeg.on('close', code => {
        if (code !== 0) {
          console.error('error processing ffmpeg. see logs for more details')
          cleanFiles()
          reject(new Error('error processing ffmpeg. see logs for more details'))
        } else {
          const fileStream = fs.createReadStream(targetFilename)
          s3.upload({
            Bucket: outputBucket,
            Key: targetKey,
            Body: fileStream
          }, err => {
            fileStream.close()
            if (err) {
              reject(err)
            } else {
              try {
                const duration = getFileDuration(targetFilename)
                cleanFiles()
                resolve({ targetKey, duration })
              } catch (err) {
                console.error('error getting file duration', err)
                reject(err)
              }
            }
          })
        }
      })
    }).catch(err => reject(err))
  })
}

const processItem = async () => {
  const srcKey = process.env.INPUT_SOURCE_KEY
  const bucket = process.env.INPUT_BUCKET
  await reportStatusUpdate(bucket, srcKey, STATUSES.PROCESSING)

  try {
    const { targetKey, duration } = await convertAudio(bucket, srcKey)
    await reportStatusUpdate(bucket, srcKey, STATUSES.COMPLETE, {
      resultKey: targetKey,
      durationSeconds: duration
    })
  } catch (err) {
    console.error('error found during processing')
    console.error(err)
    await reportStatusUpdate(bucket, srcKey, STATUSES.ERROR, err.stack)
  }
}

processItem().then(() => {
  process.exit(0)
}).catch(() => {
  process.exit(1)
})
