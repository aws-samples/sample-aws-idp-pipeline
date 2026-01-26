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
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * WorkflowStack - Step Functions Workflow for Document Analysis
 *
 * This stack handles the AI analysis phase after preprocessing is complete.
 * Preprocessing (OCR, BDA, Parser, Transcribe) is handled by separate stacks
 * and this workflow polls for their completion before proceeding.
 *
 * Flow: Workflow Queue → Trigger → Step Functions
 *       → Wait for Preprocess → SegmentBuilder → Map(Analyze) → Summarize
 */
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

    // Workflow Queue (from EventStack) - Step Functions trigger consumes from this
    const workflowQueueArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/idp-v2/preprocess/workflow/queue-arn',
    );
    const workflowQueue = sqs.Queue.fromQueueArn(
      this,
      'WorkflowQueue',
      workflowQueueArn,
    );

    // SQS Queue for LanceDB write operations
    const lancedbWriteQueue = new sqs.Queue(this, 'LanceDBWriteQueue', {
      queueName: 'idp-v2-lancedb-write-queue',
      visibilityTimeout: Duration.minutes(5),
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

    // Segment Prep (prepares segment metadata for downstream processing)
    const segmentPrep = new lambda.Function(this, 'SegmentPrep', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-prep',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/segment-prep'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    // Format Parser (extracts text from PDF, runs before waiting for async preprocessing)
    const formatParser = new lambda.Function(this, 'FormatParser', {
      ...commonLambdaProps,
      functionName: 'idp-v2-format-parser',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/format-parser'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    // Check preprocess status (called in polling loop)
    const checkPreprocessStatus = new lambda.Function(
      this,
      'CheckPreprocessStatus',
      {
        ...commonLambdaProps,
        functionName: 'idp-v2-check-preprocess-status',
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        memorySize: 256,
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../functions/step-functions/check-preprocess-status',
          ),
        ),
        layers: [sharedLayer],
      },
    );

    const segmentBuilder = new lambda.Function(this, 'SegmentBuilder', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-builder',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 256,
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
      memorySize: 256,
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
      memorySize: 256,
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
      memorySize: 256,
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

    // LanceDB Writer Lambda (consumes from SQS, concurrency=1)
    const lancedbWriter = new lambda.Function(this, 'LanceDBWriter', {
      ...commonLambdaProps,
      functionName: 'idp-v2-lancedb-writer',
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      memorySize: 256,
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
    // Step Functions Definition
    // ========================================

    // Task definitions
    const segmentPrepTask = new tasks.LambdaInvoke(this, 'PrepareSegments', {
      lambdaFunction: segmentPrep,
      outputPath: '$.Payload',
    });

    const formatParserTask = new tasks.LambdaInvoke(this, 'ParseFormat', {
      lambdaFunction: formatParser,
      outputPath: '$.Payload',
    });

    const checkPreprocessStatusTask = new tasks.LambdaInvoke(
      this,
      'CheckPreprocessStatusTask',
      {
        lambdaFunction: checkPreprocessStatus,
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

    // ========================================
    // Segment Processing
    // ========================================

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

    // ========================================
    // Preprocess Polling Loop
    // ========================================

    // Wait state before checking preprocess status
    const waitForPreprocess = new sfn.Wait(this, 'WaitForPreprocess', {
      time: sfn.WaitTime.duration(Duration.seconds(10)),
    });

    // Fail state when preprocessing fails
    const preprocessFailed = new sfn.Fail(this, 'PreprocessFailed', {
      cause: 'One or more preprocessing tasks failed',
      error: 'PREPROCESS_FAILED',
    });

    // Choice: check if preprocess is complete
    // Routes to: fail, continue to analysis, or loop back to wait
    const preprocessStatusChoice = new sfn.Choice(
      this,
      'PreprocessStatusChoice',
    )
      .when(
        sfn.Condition.booleanEquals('$.preprocess_check.any_failed', true),
        preprocessFailed,
      )
      .when(
        sfn.Condition.booleanEquals('$.preprocess_check.all_completed', true),
        segmentBuilderTask,
      )
      .otherwise(waitForPreprocess);

    // Chain: Wait → Check → Choice (which loops back or continues)
    waitForPreprocess.next(checkPreprocessStatusTask);
    checkPreprocessStatusTask.next(preprocessStatusChoice);

    // Chain: SegmentBuilder → Map(Analyze) → Summarize
    segmentBuilderTask
      .next(parallelSegmentProcessing)
      .next(documentSummarizerTask);

    // ========================================
    // Main Workflow Definition
    // ========================================

    // Parallel execution of Preprocessor and FormatParser
    // Both run concurrently, then wait for async preprocessing (OCR, BDA, Transcribe)
    const parallelPreprocessing = new sfn.Parallel(
      this,
      'ParallelPreprocessing',
      {
        resultSelector: {
          'workflow_id.$': '$[0].workflow_id',
          'project_id.$': '$[0].project_id',
          'document_id.$': '$[0].document_id',
          'file_uri.$': '$[0].file_uri',
          'file_type.$': '$[0].file_type',
          'preprocessor_metadata_uri.$': '$[0].preprocessor_metadata_uri',
          'segment_count.$': '$[0].segment_count',
          'format_parser.$': '$[1].format_parser',
        },
      },
    );
    parallelPreprocessing.branch(segmentPrepTask);
    parallelPreprocessing.branch(formatParserTask);

    // Flow: Parallel(Preprocessor, FormatParser) → Check → Choice → (loop or continue) → SegmentBuilder → Map(Analyze) → Summarize
    parallelPreprocessing.next(checkPreprocessStatusTask);
    const definition = parallelPreprocessing;

    this.stateMachine = new sfn.StateMachine(
      this,
      'DocumentAnalysisStateMachine',
      {
        stateMachineName: 'idp-v2-document-analysis',
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.hours(1),
      },
    );

    // ========================================
    // Step Function Trigger Lambda
    // ========================================

    const triggerFunction = new lambda.Function(this, 'StepFunctionTrigger', {
      ...commonLambdaProps,
      functionName: 'idp-v2-step-function-trigger',
      handler: 'index.handler',
      memorySize: 128,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-function-trigger'),
      ),
      layers: [sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        STEP_FUNCTION_ARN: this.stateMachine.stateMachineArn,
      },
    });

    // SQS Event Source for trigger (from Workflow Queue)
    triggerFunction.addEventSourceMapping('WorkflowQueueTrigger', {
      eventSourceArn: workflowQueue.queueArn,
      batchSize: 1,
    });

    // ========================================
    // IAM Permissions
    // ========================================

    const allFunctions = [
      segmentPrep,
      formatParser,
      checkPreprocessStatus,
      segmentBuilder,
      segmentAnalyzer,
      analysisFinalizer,
      documentSummarizer,
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
    workflowQueue.grantConsumeMessages(triggerFunction);

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
          ],
          resources: ['*'],
        }),
      );
    }

    // Step Functions permissions for trigger
    this.stateMachine.grantStartExecution(triggerFunction);

    // Store State Machine ARN in SSM
    new ssm.StringParameter(this, 'StateMachineArn', {
      parameterName: '/idp-v2/stepfunction/arn',
      stringValue: this.stateMachine.stateMachineArn,
    });
  }
}
