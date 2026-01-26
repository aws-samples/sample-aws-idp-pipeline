import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * EventStack - S3 EventBridge, SQS Queues, Type Detection Lambda
 *
 * Handles document upload events and distributes to preprocessing queues.
 */
export class EventStack extends Stack {
  public readonly ocrQueue: sqs.Queue;
  public readonly bdaQueue: sqs.Queue;
  public readonly transcribeQueue: sqs.Queue;
  public readonly workflowQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // Lookup Existing Resources (from SSM)
    // ========================================

    const documentBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const documentBucket = s3.Bucket.fromBucketName(
      this,
      'DocumentBucket',
      documentBucketName,
    );

    const backendTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = dynamodb.Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    // SageMaker endpoint name for direct scale-out trigger
    const sagemakerEndpointName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.PADDLEOCR_ENDPOINT_NAME,
    );

    // ========================================
    // SQS Queues with Dead Letter Queues
    // ========================================

    // OCR Queue (for PDF/Image processing via SageMaker)
    const ocrDlq = new sqs.Queue(this, 'OcrDLQ', {
      queueName: 'idp-v2-ocr-dlq',
      retentionPeriod: Duration.days(14),
    });
    this.ocrQueue = new sqs.Queue(this, 'OcrQueue', {
      queueName: 'idp-v2-ocr-queue',
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: {
        queue: ocrDlq,
        maxReceiveCount: 3,
      },
    });

    // BDA Queue (for Bedrock Document Analysis)
    const bdaDlq = new sqs.Queue(this, 'BdaDLQ', {
      queueName: 'idp-v2-bda-dlq',
      retentionPeriod: Duration.days(14),
    });
    this.bdaQueue = new sqs.Queue(this, 'BdaQueue', {
      queueName: 'idp-v2-bda-queue',
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: {
        queue: bdaDlq,
        maxReceiveCount: 3,
      },
    });

    // Transcribe Queue (for video/audio transcription)
    const transcribeDlq = new sqs.Queue(this, 'TranscribeDLQ', {
      queueName: 'idp-v2-transcribe-dlq',
      retentionPeriod: Duration.days(14),
    });
    this.transcribeQueue = new sqs.Queue(this, 'TranscribeQueue', {
      queueName: 'idp-v2-transcribe-queue',
      visibilityTimeout: Duration.minutes(30),
      deadLetterQueue: {
        queue: transcribeDlq,
        maxReceiveCount: 3,
      },
    });

    // Workflow Queue (for Step Functions to consume)
    const workflowDlq = new sqs.Queue(this, 'WorkflowDLQ', {
      queueName: 'idp-v2-workflow-dlq',
      retentionPeriod: Duration.days(14),
    });
    this.workflowQueue = new sqs.Queue(this, 'WorkflowQueue', {
      queueName: 'idp-v2-workflow-queue',
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: {
        queue: workflowDlq,
        maxReceiveCount: 3,
      },
    });

    // ========================================
    // Store Queue URLs in SSM
    // ========================================

    new ssm.StringParameter(this, 'OcrQueueUrlParam', {
      parameterName: SSM_KEYS.PREPROCESS_OCR_QUEUE_URL,
      stringValue: this.ocrQueue.queueUrl,
    });

    new ssm.StringParameter(this, 'OcrQueueArnParam', {
      parameterName: '/idp-v2/preprocess/ocr/queue-arn',
      stringValue: this.ocrQueue.queueArn,
    });

    new ssm.StringParameter(this, 'BdaQueueUrlParam', {
      parameterName: SSM_KEYS.PREPROCESS_BDA_QUEUE_URL,
      stringValue: this.bdaQueue.queueUrl,
    });

    new ssm.StringParameter(this, 'BdaQueueArnParam', {
      parameterName: '/idp-v2/preprocess/bda/queue-arn',
      stringValue: this.bdaQueue.queueArn,
    });

    new ssm.StringParameter(this, 'TranscribeQueueUrlParam', {
      parameterName: SSM_KEYS.PREPROCESS_TRANSCRIBE_QUEUE_URL,
      stringValue: this.transcribeQueue.queueUrl,
    });

    new ssm.StringParameter(this, 'TranscribeQueueArnParam', {
      parameterName: '/idp-v2/preprocess/transcribe/queue-arn',
      stringValue: this.transcribeQueue.queueArn,
    });

    new ssm.StringParameter(this, 'WorkflowQueueUrlParam', {
      parameterName: SSM_KEYS.PREPROCESS_WORKFLOW_QUEUE_URL,
      stringValue: this.workflowQueue.queueUrl,
    });

    new ssm.StringParameter(this, 'WorkflowQueueArnParam', {
      parameterName: '/idp-v2/preprocess/workflow/queue-arn',
      stringValue: this.workflowQueue.queueArn,
    });

    // ========================================
    // Trigger Queue for EventBridge
    // ========================================

    const triggerQueue = new sqs.Queue(this, 'TriggerQueue', {
      queueName: 'idp-v2-preprocessing-trigger-queue',
      visibilityTimeout: Duration.minutes(5),
    });

    // ========================================
    // Enable EventBridge notifications on S3 bucket
    // ========================================

    new cr.AwsCustomResource(this, 'EnableS3EventBridge', {
      onCreate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: {
          Bucket: documentBucketName,
          NotificationConfiguration: {
            EventBridgeConfiguration: {},
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `${documentBucketName}-eventbridge-preprocessing`,
        ),
      },
      onUpdate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: {
          Bucket: documentBucketName,
          NotificationConfiguration: {
            EventBridgeConfiguration: {},
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `${documentBucketName}-eventbridge-preprocessing`,
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            's3:PutBucketNotification',
            's3:PutBucketNotificationConfiguration',
            's3:GetBucketNotification',
            's3:GetBucketNotificationConfiguration',
          ],
          resources: [documentBucket.bucketArn],
        }),
      ]),
    });

    // ========================================
    // EventBridge Rule for S3 Upload
    // ========================================

    new events.Rule(this, 'S3UploadPreprocessRule', {
      ruleName: 'idp-v2-s3-upload-preprocess',
      description: 'Trigger preprocessing on S3 upload',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [documentBucketName],
          },
          object: {
            key: [
              {
                'anything-but': {
                  wildcard: 'projects/*/documents/*/*/*',
                },
              },
            ],
          },
        },
      },
      targets: [new targets.SqsQueue(triggerQueue)],
    });

    // ========================================
    // Shared Code Layer
    // ========================================

    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-event-shared',
      description: 'Shared Python modules for event processing',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: lambda.Code.fromAsset(path.join(__dirname, '../functions'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_14.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir: string): boolean {
              const pythonDir = path.join(outputDir, 'python');
              const sharedSrc = path.join(__dirname, '../functions/shared');
              const sharedDst = path.join(pythonDir, 'shared');
              fs.mkdirSync(sharedDst, { recursive: true });
              fs.cpSync(sharedSrc, sharedDst, { recursive: true });
              return true;
            },
          },
        },
      }),
    });

    // ========================================
    // Type Detection Lambda
    // ========================================

    const typeDetection = new lambda.Function(this, 'TypeDetection', {
      functionName: 'idp-v2-type-detection',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      memorySize: 512,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/type-detection'),
      ),
      layers: [sharedLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        OCR_QUEUE_URL: this.ocrQueue.queueUrl,
        BDA_QUEUE_URL: this.bdaQueue.queueUrl,
        TRANSCRIBE_QUEUE_URL: this.transcribeQueue.queueUrl,
        WORKFLOW_QUEUE_URL: this.workflowQueue.queueUrl,
        SAGEMAKER_ENDPOINT_NAME: sagemakerEndpointName,
      },
    });

    // Grant permissions
    backendTable.grantReadWriteData(typeDetection);
    this.ocrQueue.grantSendMessages(typeDetection);
    this.bdaQueue.grantSendMessages(typeDetection);
    this.transcribeQueue.grantSendMessages(typeDetection);
    this.workflowQueue.grantSendMessages(typeDetection);

    // Grant permission to trigger SageMaker scale-out
    typeDetection.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['application-autoscaling:RegisterScalableTarget'],
        resources: ['*'],
      }),
    );

    // Trigger from SQS
    typeDetection.addEventSource(
      new lambdaEventSources.SqsEventSource(triggerQueue, {
        batchSize: 1,
      }),
    );
  }
}
