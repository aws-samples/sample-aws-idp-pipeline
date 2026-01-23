import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WorkflowStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly documentBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // Lookup Existing Storage Resources (from SSM)
    // ========================================

    // LanceDB Express Bucket (S3 Directory Bucket)
    const lancedbExpressBucketName =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
      );

    // LanceDB Storage Bucket (Standard S3)
    const lancedbStorageBucketName =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.LANCEDB_STORAGE_BUCKET_NAME,
      );
    const lancedbStorageBucket = s3.Bucket.fromBucketName(
      this,
      'LanceDBStorageBucket',
      lancedbStorageBucketName,
    );

    // LanceDB Lock Table (DynamoDB)
    const lancedbLockTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
    );
    const lancedbLockTable = dynamodb.Table.fromTableName(
      this,
      'LanceDBLockTable',
      lancedbLockTableName,
    );

    // Backend Table (existing) - for workflow state management
    const backendTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = dynamodb.Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    // Document Storage Bucket (existing)
    const documentBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    this.documentBucket = s3.Bucket.fromBucketName(
      this,
      'DocumentBucket',
      documentBucketName,
    );

    // PaddleOCR Endpoint Name (from PaddleOcrStack)
    const paddleOcrEndpointName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.PADDLEOCR_ENDPOINT_NAME,
    );

    // Model Artifacts Bucket (for PaddleOCR async inference output)
    const modelArtifactsBucketName =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.MODEL_ARTIFACTS_BUCKET_NAME,
      );
    const modelArtifactsBucket = s3.Bucket.fromBucketName(
      this,
      'ModelArtifactsBucket',
      modelArtifactsBucketName,
    );

    // Enable EventBridge notifications on existing S3 bucket
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
          `${documentBucketName}-eventbridge`,
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
          `${documentBucketName}-eventbridge`,
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
          resources: [this.documentBucket.bucketArn],
        }),
      ]),
    });

    // SQS Queue for S3 event triggers
    const triggerQueue = new sqs.Queue(this, 'TriggerQueue', {
      visibilityTimeout: Duration.minutes(15),
    });

    // SQS Queue for LanceDB write operations
    const lancedbWriteQueue = new sqs.Queue(this, 'LanceDBWriteQueue', {
      queueName: 'idp-v2-lancedb-write-queue',
      visibilityTimeout: Duration.minutes(5),
    });

    // ========================================
    // EventBridge Rule for S3 Upload Trigger
    // ========================================

    new events.Rule(this, 'S3UploadTriggerRule', {
      ruleName: 'idp-v2-s3-upload-trigger',
      description: 'Trigger document analysis workflow on S3 upload',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [documentBucketName],
          },
          object: {
            // Only trigger for direct files under document_id/
            // Exclude: projects/*/documents/*/{subfolder}/* (6+ segments)
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
    // Lambda Layers
    // ========================================

    const createLayerCode = (packages: string, layerName: string) => {
      const layerDir = path.join(__dirname, `../lambda-layers/${layerName}`);
      if (!fs.existsSync(layerDir)) {
        fs.mkdirSync(layerDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(layerDir, 'requirements.txt'),
        packages.split(' ').join('\n'),
      );

      return lambda.Code.fromAsset(layerDir, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_14.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                const pythonDir = path.join(outputDir, 'python');
                fs.mkdirSync(pythonDir, { recursive: true });
                execSync(
                  `pip install -t "${pythonDir}" ` +
                    `--platform manylinux2014_x86_64 ` +
                    `--python-version 3.14 ` +
                    `--implementation cp ` +
                    `--only-binary=:all: ${packages}`,
                  { stdio: 'inherit' },
                );
                return true;
              } catch (e) {
                console.error(`Local bundling failed: ${e}`);
                return false;
              }
            },
          },
        },
      });
    };

    const coreLayer = new lambda.LayerVersion(this, 'CoreLibsLayer', {
      layerVersionName: 'idp-v2-core-libs',
      description: 'boto3, pillow, PyMuPDF, pypdf',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: createLayerCode('boto3 pillow pymupdf pypdf', 'core'),
    });

    const strandsLayer = new lambda.LayerVersion(this, 'StrandsLayer', {
      layerVersionName: 'idp-v2-strands',
      description: 'Strands Agents SDK with PyYAML',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: createLayerCode('strands-agents pyyaml', 'strands'),
    });

    // Shared code layer (ddb_client, embeddings)
    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-shared',
      description: 'Shared Python modules (ddb_client, embeddings)',
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
    // LanceDB Service (Container Lambda)
    // ========================================

    const lancedbService = new lambda.DockerImageFunction(
      this,
      'LanceDBService',
      {
        functionName: 'idp-v2-lancedb-service',
        code: lambda.DockerImageCode.fromImageAsset(
          path.join(__dirname, '../functions/container'),
          {
            platform: Platform.LINUX_AMD64,
          },
        ),
        architecture: lambda.Architecture.X86_64,
        timeout: Duration.minutes(5),
        memorySize: 2048,
      },
    );

    // ========================================
    // Lambda Functions
    // ========================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_14,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        BDA_OUTPUT_BUCKET: this.documentBucket.bucketName,
        BACKEND_TABLE_NAME: backendTableName,
      },
    };

    const preprocessor = new lambda.Function(this, 'Preprocessor', {
      ...commonLambdaProps,
      functionName: 'idp-v2-preprocessor',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 2048,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/preprocessor'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    const bdaProcessor = new lambda.Function(this, 'BdaProcessor', {
      ...commonLambdaProps,
      functionName: 'idp-v2-bda-processor',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/bda-processor'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    const bdaStatusChecker = new lambda.Function(this, 'BdaStatusChecker', {
      ...commonLambdaProps,
      functionName: 'idp-v2-bda-status-checker',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/bda-status-checker'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    const formatParser = new lambda.Function(this, 'FormatParser', {
      ...commonLambdaProps,
      functionName: 'idp-v2-format-parser',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 2048,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/format-parser'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    const segmentBuilder = new lambda.Function(this, 'SegmentBuilder', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-builder',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 2048,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/segment-builder'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    const segmentAnalyzer = new lambda.Function(this, 'SegmentAnalyzer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-analyzer',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 3008,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/segment-analyzer'),
      ),
      layers: [coreLayer, strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
        BEDROCK_VIDEO_MODEL_ID: 'us.twelvelabs.pegasus-1-2-v1:0',
        BUCKET_OWNER_ACCOUNT_ID: this.account,
      },
    });

    const analysisFinalizer = new lambda.Function(this, 'AnalysisFinalizer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-analysis-finalizer',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/analysis-finalizer'),
      ),
      layers: [coreLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_WRITE_QUEUE_URL: lancedbWriteQueue.queueUrl,
      },
    });

    const documentSummarizer = new lambda.Function(this, 'DocumentSummarizer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-document-summarizer',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/document-summarizer'),
      ),
      layers: [coreLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
        SUMMARIZER_MODEL_ID: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      },
    });

    const paddleocrProcessor = new lambda.Function(this, 'PaddleOcrProcessor', {
      ...commonLambdaProps,
      functionName: 'idp-v2-paddleocr-processor',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/paddleocr-processor'),
      ),
      layers: [coreLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        PADDLEOCR_ENDPOINT_NAME: paddleOcrEndpointName,
        DOCUMENT_BUCKET_NAME: this.documentBucket.bucketName,
      },
    });

    // LanceDB Writer Lambda (consumes from SQS, concurrency=1)
    const lancedbWriter = new lambda.Function(this, 'LanceDBWriter', {
      ...commonLambdaProps,
      functionName: 'idp-v2-lancedb-writer',
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      reservedConcurrentExecutions: 1,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/lancedb-writer'),
      ),
      layers: [coreLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
      },
    });

    // SQS trigger for LanceDB Writer
    lancedbWriter.addEventSourceMapping('LanceDBWriteQueueTrigger', {
      eventSourceArn: lancedbWriteQueue.queueArn,
      batchSize: 1,
    });

    // ========================================
    // Step Functions
    // ========================================

    // Task definitions
    const preprocessorTask = new tasks.LambdaInvoke(this, 'Preprocess', {
      lambdaFunction: preprocessor,
      outputPath: '$.Payload',
    });

    const startBdaTask = new tasks.LambdaInvoke(this, 'StartBdaProcessing', {
      lambdaFunction: bdaProcessor,
      outputPath: '$.Payload',
    });

    const checkBdaStatusTask = new tasks.LambdaInvoke(this, 'CheckBdaStatus', {
      lambdaFunction: bdaStatusChecker,
      outputPath: '$.Payload',
    });

    const formatParserTask = new tasks.LambdaInvoke(this, 'ParseFormat', {
      lambdaFunction: formatParser,
      outputPath: '$.Payload',
    });

    const paddleocrProcessorTask = new tasks.LambdaInvoke(
      this,
      'ProcessPaddleOcr',
      {
        lambdaFunction: paddleocrProcessor,
        outputPath: '$.Payload',
      },
    );

    const segmentBuilderTask = new tasks.LambdaInvoke(this, 'BuildSegments', {
      lambdaFunction: segmentBuilder,
      outputPath: '$.Payload',
    });

    const segmentAnalyzerTask = new tasks.LambdaInvoke(this, 'AnalyzeSegment', {
      lambdaFunction: segmentAnalyzer,
      outputPath: '$.Payload',
    });

    const analysisFinalizerTask = new tasks.LambdaInvoke(
      this,
      'FinalizeAnalysis',
      {
        lambdaFunction: analysisFinalizer,
        outputPath: '$.Payload',
      },
    );

    const documentSummarizerTask = new tasks.LambdaInvoke(
      this,
      'SummarizeDocument',
      {
        lambdaFunction: documentSummarizer,
        outputPath: '$.Payload',
      },
    );

    // Wait state for BDA polling
    const waitForBda = new sfn.Wait(this, 'WaitForBda', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });

    // BDA complete pass state
    const bdaCompletePass = new sfn.Pass(this, 'BdaComplete');

    // BDA status choice
    const bdaStatusChoice = new sfn.Choice(this, 'BdaStatusChoice')
      .when(sfn.Condition.stringEquals('$.status', 'InProgress'), waitForBda)
      .when(sfn.Condition.stringEquals('$.status', 'Created'), waitForBda)
      .when(sfn.Condition.stringEquals('$.status', 'Success'), bdaCompletePass)
      .when(
        sfn.Condition.stringEquals('$.status', 'Failed'),
        new sfn.Fail(this, 'BdaFailed', {
          cause: 'BDA processing failed',
          error: 'BDA_FAILED',
        }),
      )
      .otherwise(bdaCompletePass);

    // BDA branch (only runs if use_bda=true)
    waitForBda.next(checkBdaStatusTask);
    checkBdaStatusTask.next(bdaStatusChoice);
    const bdaBranch = startBdaTask.next(checkBdaStatusTask);

    // Skip BDA pass state
    const skipBdaPass = new sfn.Pass(this, 'SkipBda');

    // BDA choice (check use_bda flag)
    const useBdaChoice = new sfn.Choice(this, 'UseBdaChoice')
      .when(sfn.Condition.booleanEquals('$.use_bda', true), bdaBranch)
      .otherwise(skipBdaPass);

    // OCR branch - runs for PDF and image files
    const ocrSupportedChoice = new sfn.Choice(this, 'OcrSupportedChoice')
      .when(
        sfn.Condition.stringEquals('$.file_type', 'application/pdf'),
        paddleocrProcessorTask,
      )
      .when(
        sfn.Condition.stringEquals('$.file_type', 'image/png'),
        paddleocrProcessorTask,
      )
      .when(
        sfn.Condition.stringEquals('$.file_type', 'image/jpeg'),
        paddleocrProcessorTask,
      )
      .when(
        sfn.Condition.stringEquals('$.file_type', 'image/tiff'),
        paddleocrProcessorTask,
      )
      .otherwise(new sfn.Pass(this, 'SkipOcr'));

    // Parser branch - runs for PDF files
    const parserSupportedChoice = new sfn.Choice(this, 'ParserSupportedChoice')
      .when(
        sfn.Condition.stringEquals('$.file_type', 'application/pdf'),
        formatParserTask,
      )
      .otherwise(new sfn.Pass(this, 'SkipParser'));

    // Parallel processing: BDA (optional), OCR, and Parser run in parallel
    const parallelProcessing = new sfn.Parallel(this, 'ParallelProcessing', {
      resultSelector: {
        // Take the first result that has all the needed fields
        // The parallel branches return the same base event with their specific additions
        'workflow_id.$': '$[0].workflow_id',
        'document_id.$': '$[0].document_id',
        'project_id.$': '$[0].project_id',
        'file_uri.$': '$[0].file_uri',
        'file_type.$': '$[0].file_type',
        'use_bda.$': '$[0].use_bda',
        'language.$': '$[0].language',
        'segment_count.$': '$[0].segment_count',
        // BDA results are read directly from S3 by SegmentBuilder
      },
    });

    parallelProcessing.branch(useBdaChoice);
    parallelProcessing.branch(ocrSupportedChoice);
    parallelProcessing.branch(parserSupportedChoice);

    // Segment processing chain: Analyze → Finalize
    const segmentProcessing = segmentAnalyzerTask.next(analysisFinalizerTask);

    // Distributed Map for parallel segment processing
    const parallelSegmentProcessing = new sfn.Map(
      this,
      'ProcessSegmentsInParallel',
      {
        maxConcurrency: 30,
        itemsPath: '$.segment_ids',
        resultPath: sfn.JsonPath.DISCARD,
        itemSelector: {
          'workflow_id.$': '$.workflow_id',
          'project_id.$': '$.project_id',
          'file_uri.$': '$.file_uri',
          'file_type.$': '$.file_type',
          'segment_count.$': '$.segment_count',
          'segment_index.$': '$$.Map.Item.Value',
        },
      },
    );
    parallelSegmentProcessing.itemProcessor(segmentProcessing);

    // Build the state machine chain
    // Preprocessor → Parallel(BDA, OCR, Parser) → SegmentBuilder → Map(Analyze) → Summarize
    const definition = preprocessorTask
      .next(parallelProcessing)
      .next(segmentBuilderTask)
      .next(parallelSegmentProcessing)
      .next(documentSummarizerTask);

    this.stateMachine = new sfn.StateMachine(
      this,
      'DocumentAnalysisStateMachine',
      {
        stateMachineName: 'idp-v2-document-analysis',
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.hours(1),
      },
    );

    // Step Function Trigger Lambda
    const triggerFunction = new lambda.Function(this, 'StepFunctionTrigger', {
      ...commonLambdaProps,
      functionName: 'idp-v2-step-function-trigger',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-function-trigger'),
      ),
      layers: [sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        STEP_FUNCTION_ARN: this.stateMachine.stateMachineArn,
      },
    });

    // SQS Event Source for trigger
    triggerFunction.addEventSourceMapping('SqsTrigger', {
      eventSourceArn: triggerQueue.queueArn,
      batchSize: 1,
    });

    // ========================================
    // IAM Permissions (Individual per Lambda)
    // ========================================

    const allFunctions = [
      preprocessor,
      bdaProcessor,
      bdaStatusChecker,
      formatParser,
      segmentBuilder,
      segmentAnalyzer,
      analysisFinalizer,
      documentSummarizer,
      paddleocrProcessor,
      triggerFunction,
      lancedbService,
      lancedbWriter,
    ];

    // Grant invoke permissions for LanceDB service
    lancedbService.grantInvoke(lancedbWriter);
    lancedbService.grantInvoke(documentSummarizer);

    // SQS permissions
    lancedbWriteQueue.grantSendMessages(analysisFinalizer);
    lancedbWriteQueue.grantConsumeMessages(lancedbWriter);

    // SageMaker permissions for PaddleOCR Processor
    paddleocrProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sagemaker:InvokeEndpoint', 'sagemaker:InvokeEndpointAsync'],
        resources: [
          `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${paddleOcrEndpointName}`,
        ],
      }),
    );

    // Model Artifacts Bucket permissions for PaddleOCR (async inference output cleanup)
    modelArtifactsBucket.grantReadWrite(paddleocrProcessor);

    for (const fn of allFunctions) {
      // S3 permissions (Document bucket)
      this.documentBucket.grantReadWrite(fn);

      // S3 Express One Zone permissions (LanceDB)
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            's3express:CreateSession',
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:ListBucket',
          ],
          resources: [
            `arn:aws:s3express:${this.region}:${this.account}:bucket/${lancedbExpressBucketName}`,
            `arn:aws:s3express:${this.region}:${this.account}:bucket/${lancedbExpressBucketName}/*`,
          ],
        }),
      );

      // S3 Standard permissions (LanceDB Storage)
      lancedbStorageBucket.grantReadWrite(fn);

      // DynamoDB permissions for LanceDB Lock table
      lancedbLockTable.grantReadWriteData(fn);

      // DynamoDB permissions for Backend table (workflow state)
      backendTable.grantReadWriteData(fn);

      // SSM permissions
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter/idp-v2/*`,
          ],
        }),
      );

      // Bedrock permissions
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:CreateDataAutomationProject',
            'bedrock:UpdateDataAutomationProject',
            'bedrock:GetDataAutomationProject',
            'bedrock:ListDataAutomationProjects',
            'bedrock:InvokeDataAutomationAsync',
            'bedrock:GetDataAutomationStatus',
          ],
          resources: ['*'],
        }),
      );

    }

    // Step Functions permissions for trigger
    this.stateMachine.grantStartExecution(triggerFunction);

    // SQS permissions for trigger
    triggerQueue.grantConsumeMessages(triggerFunction);

    // Store State Machine ARN in SSM
    new ssm.StringParameter(this, 'StateMachineArn', {
      parameterName: '/idp-v2/stepfunction/arn',
      stringValue: this.stateMachine.stateMachineArn,
    });
  }
}
