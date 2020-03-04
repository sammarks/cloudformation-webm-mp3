![][header-image]

[![CircleCI](https://img.shields.io/circleci/build/github/sammarks/cloudformation-webm-mp3/master)](https://circleci.com/gh/sammarks/cloudformation-webm-mp3)
[![Coveralls](https://img.shields.io/coveralls/sammarks/cloudformation-webm-mp3.svg)](https://coveralls.io/github/sammarks/cloudformation-webm-mp3)
[![Dev Dependencies](https://david-dm.org/sammarks/cloudformation-webm-mp3/dev-status.svg)](https://david-dm.org/sammarks/cloudformation-webm-mp3?type=dev)
[![Donate](https://img.shields.io/badge/donate-paypal-blue.svg)](https://paypal.me/sammarks15)

`cloudformation-webm-mp3` is an AWS SAM + CloudFormation template designed to ingest WEBM audio
files and convert them to MP3 files. It sends a notification through SNS to keep track of
progress, generate information about the audio file (like duration) and completion.

## Get Started

It's simple! Click this fancy button:

[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/new?stackName=webm-mp3&templateURL=https://sammarks-cf-templates.s3.amazonaws.com/webm-mp3/template.yaml)

Then give the stack a name, and configure it:

### Parameters

| Parameter | Required | Default Value | Description |
| --- | --- | --- | --- |
| InputBucketName | **Yes** | | The name of the bucket to use for audio inputs. **This bucket MUST NOT already exist.** |
| OutputBucketName | **Yes** | | The name of the bucket to use for output audio files. **This bucket MUST already exist.** |
| SubnetNames | **Yes** | | A comma-separated list of VPC subnets to launch the Fargate container in. |
| SecurityGroupNames | **Yes** | | A comma-separated list of VPC security groups (that have access to the internet) to launch the Fargate container in. |
| ContainerName | No | `webm-convert-audio` | The name of the Fargate container. |

### Outputs

| Output | Description |
| --- | --- |
| InputBucket | The name of the bucket where audio files should be uploaded. |
| InputBucketArn | The ARN for the bucket where audio files should be uploaded. |
| Topic | The ARN for the SNS Topic to subscribe to for pipeline notifications. |
| S3Topic | The ARN for the SNS Topic to subscribe to for object creation notifications from the input bucket. |

### Usage in Another Stack or Serverless

Add something like this underneath resources:

```yaml
videoThumbnailStack:
  Type: AWS::CloudFormation::Stack
  Properties:
    TemplateURL: https://sammarks-cf-templates.s3.amazonaws.com/webm-mp3/VERSION/template.yaml
    Parameters:
      InputBucketName: test-input-bucket
      OutputBucketName: test-output-bucket
      SubnetNames: subnet-aaaaa,subnet-bbbbb
      SecurityGroupNames: sg-aaaaa,sg-bbbbb
      ContainerName: webm-convert-audio
```

**Note:** This stack will require the `CAPABILITY_AUTO_EXPAND` capability when deploying
the parent stack with CloudFormation. If you are using the Serverless framework, you can
"trick" it into adding the required capabilities by adding this to your `serverless.yaml`:

```yaml
resources:
  Transform: 'AWS::Serverless-2016-10-31' # Trigger Serverless to add CAPABILITY_AUTO_EXPAND
  Resources:
    otherResource: # ... all of your original resources
```

### Regions

**A quick note on regions:** If you are deploying this stack in a region other than `us-east-1`,
you need to reference the proper region S3 bucket as we're deploying Lambda functions. Just
add the region suffix to the template URL, so this:

```
https://sammarks-cf-templates.s3.amazonaws.com/webm-mp3/VERSION/template.yaml
```

becomes this:

```
https://sammarks-cf-templates-us-east-2.s3.amazonaws.com/webm-mp3/VERSION/template.yaml
```

### Subscribing to object creation events

S3 does not allow two separate Lambda functions to be subscribed to the same
event types on a single bucket. Because of this, the template creates an SNS
topic to serve as the messenger for the S3 notifications, and the internal
Lambda function subscribes to that SNS topic.

Because of this, if you want to subscribe to the object creation events in your
own Lambda functions, simply create a Lambda function that references the
`S3Topic` output of this stack.

### What's deployed?

- One S3 bucket, for audio input.
- A SNS topic for notifications.
- A SNS topic for object created notifications for the input bucket.
- An ECS cluster and task definition to contain the configuration for the
  conversion Docker container.
- A Lambda function to launch a new instance of the task definition inside
  Fargate when an audio file needs to be converted.

### How does it work?

Whenever an audio file is uploaded to the input bucket, it goes through the following
process:

- The Lambda is triggered and verifies the file ends in `.webm` - it will throw
  an error if it does not.
- Lambda creates a new instance of the task definition and launches it inside
  Fargate with your provided VPC configuration.
- The Docker container downloads the file to temporary storage, runs it through
  `ffmpeg` to convert the container from WEBM to MP3, and then uploads the result
  to the destination bucket inside S3.
  - It gathers information about the audio file (like duration) and records it
    as well.
- Send a notification to SNS when the process is complete or errors.

#### Why Fargate / Docker containers?

See [cloudformation-webm-mp4](https://github.com/sammarks/cloudformation-webm-mp4#why-fargate--docker-containers) for more information.

### Accessing Previous Versions & Upgrading

Each time a release is made in this repository, the corresponding template is available at:

```
https://sammarks-cf-templates.s3.amazonaws.com/webm-mp3/VERSION/template.yaml
```

**On upgrading:** I actually _recommend_ you lock the template you use to a specific version. Then, if you want to update to a new version, all you have to change in your CloudFormation template is the version and AWS will automatically delete the old stack and re-create the new one for you.

## Features

- Automatically convert `webm` audio files to `mp3` files.
- Send notifications about updates and error messages to a SNS topic.
- Uses AWS Lambda + AWS Fargate so you only pay for the hours you are actively converting something.
- Deploy with other CloudFormation-compatible frameworks (like the Serverless framework).
- All functionality is self-contained within one CloudFormation template. Delete the template, and all of our created resources are removed.

## Why use this?

The inspiration for this template was to easily convert audio files
generated using the [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) APIs to MP3 files for broader consumption on mobile devices.

Running a Docker container with `ffmpeg` installed inside AWS Fargate to achieve this becomes
immensely cheaper than using something like AWS' ElementalMedia services because converting
audio files is quick and easy with the smaller file sizes, so
we don't need the massive amount of CPU power something like AWS' ElementalMedia provides.

[header-image]: https://raw.githubusercontent.com/sammarks/art/master/cloudformation-webm-mp3/header.jpg
