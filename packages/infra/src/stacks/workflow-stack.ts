import { AssetHashType, Duration, Size, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  PADDLEOCR_ENDPOINT_NAME_VALUE,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import models from '../models.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * WorkflowStack - Step Functions Workflow for Document Analysis
 *
 * This stack orchestrates the full document processing pipeline including
 * preprocessing (OCR, BDA, Transcribe, WebCrawler) and AI analysis.
 *
 * Flow: Workflow Queue → Trigger → Step Functions
 *       → Parallel(SegmentPrep, FormatParser, BDA, OCR, Transcribe, WebCrawler)
 *       → CheckAnalysisThrottle → SegmentBuilder → Map(Analyze) → Summarize
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

    // Agent Storage Bucket (for analysis prompts)
    const agentStorageBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );
    const agentStorageBucket = s3.Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    // OCR Lambda Processor function name (from OcrStack)
    const ocrLambdaProcessorFunctionName =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.OCR_LAMBDA_PROCESSOR_FUNCTION_NAME,
      );
    const ocrLambdaProcessor = lambda.Function.fromFunctionName(
      this,
      'OcrLambdaProcessor',
      ocrLambdaProcessorFunctionName,
    );

    // WebCrawler Agent Runtime ARN
    const webcrawlerAgentRuntimeArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.WEBCRAWLER_AGENT_RUNTIME_ARN,
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

    // SQS Queue for graph deletion (async, batched)
    const graphDeleteDlq = new sqs.Queue(this, 'GraphDeleteDLQ', {
      queueName: 'idp-v2-graph-delete-dlq',
    });
    const graphDeleteQueue = new sqs.Queue(this, 'GraphDeleteQueue', {
      queueName: 'idp-v2-graph-delete-queue',
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: { queue: graphDeleteDlq, maxReceiveCount: 3 },
    });

    // ========================================
    // Lambda Layers
    // ========================================

    const LAYER_PLATFORM = 'manylinux2014_aarch64';
    const LAYER_PYTHON_VERSION = '3.14';

    const createLayerCode = (packages: string[], layerName: string) => {
      const quotedPackages = packages.map((p) => `'${p}'`).join(' ');
      const layerDir = path.join(__dirname, `../lambda-layers/${layerName}`);
      if (!fs.existsSync(layerDir)) {
        fs.mkdirSync(layerDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(layerDir, 'requirements.txt'),
        packages.join('\n'),
      );
      // Include platform info so asset hash changes when platform/version changes
      fs.writeFileSync(
        path.join(layerDir, '.platform'),
        `${LAYER_PLATFORM}\n${LAYER_PYTHON_VERSION}\n`,
      );

      return lambda.Code.fromAsset(layerDir, {
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          image: lambda.Runtime.PYTHON_3_14.bundlingImage,
          command: [
            'bash',
            '-c',
            `pip install -t /asset-output/python ` +
              `--platform ${LAYER_PLATFORM} ` +
              `--python-version ${LAYER_PYTHON_VERSION} ` +
              `--implementation cp ` +
              `--only-binary=:all: ${quotedPackages}`,
          ],
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                const pythonDir = path.join(outputDir, 'python');
                fs.mkdirSync(pythonDir, { recursive: true });
                execSync(
                  `pip install -t "${pythonDir}" ` +
                    `--platform ${LAYER_PLATFORM} ` +
                    `--python-version ${LAYER_PYTHON_VERSION} ` +
                    `--implementation cp ` +
                    `--only-binary=:all: ${quotedPackages}`,
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
      description: 'boto3, pillow, pypdfium2, pypdf, pyyaml, python-docx',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      code: createLayerCode(
        ['boto3', 'pillow', 'pypdfium2', 'pypdf', 'pyyaml', 'python-docx'],
        'core',
      ),
    });

    const strandsLayer = new lambda.LayerVersion(this, 'StrandsLayer', {
      layerVersionName: 'idp-v2-strands',
      description: 'Strands Agents SDK 1.25+ with PyYAML',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      code: createLayerCode(['strands-agents>=1.25', 'pyyaml'], 'strands'),
    });

    // Shared code layer (ddb_client, embeddings)
    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-shared',
      description: 'Shared Python modules (ddb_client, embeddings)',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
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

    const tokaFunctionName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.TOKA_FUNCTION_NAME,
    );
    const tokaFunction = lambda.Function.fromFunctionName(
      this,
      'TokaFunction',
      tokaFunctionName,
    );

    const lancedbService = new lambda.DockerImageFunction(
      this,
      'LanceDBService',
      {
        functionName: 'idp-v2-lancedb-service',
        code: lambda.DockerImageCode.fromImageAsset(
          path.join(__dirname, '../functions/container'),
          {
            platform: Platform.LINUX_ARM64,
          },
        ),
        architecture: lambda.Architecture.ARM_64,
        timeout: Duration.minutes(5),
        memorySize: 2048,
        environment: {
          TOKA_FUNCTION_NAME: tokaFunctionName,
        },
      },
    );

    tokaFunction.grantInvoke(lancedbService);

    // ========================================
    // GraphService (Neptune DB Serverless Gateway Lambda)
    // ========================================

    const neptuneEndpoint = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.NEPTUNE_CLUSTER_ENDPOINT,
    );
    const neptunePort = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.NEPTUNE_CLUSTER_PORT,
    );
    // Import VPC for graph-service Lambda (valueFromLookup resolves at synth time)
    const vpcId = ssm.StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = ec2.Vpc.fromLookup(this, 'GraphServiceVpc', { vpcId });

    // Security group for graph-service Lambda
    const graphServiceSg = new ec2.SecurityGroup(this, 'GraphServiceSG', {
      vpc,
      description: 'Security group for graph-service Lambda',
      allowAllOutbound: true,
    });

    const graphService = new lambda.Function(this, 'GraphService', {
      functionName: 'idp-v2-graph-service',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/graph-service'),
      ),
      timeout: Duration.minutes(5),
      memorySize: 1024,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [graphServiceSg],
      environment: {
        NEPTUNE_ENDPOINT: neptuneEndpoint,
        NEPTUNE_PORT: neptunePort,
      },
    });

    // Grant Neptune DB access (IAM auth)
    graphService.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['neptune-db:*'],
        resources: ['*'],
      }),
    );

    // Graph Delete Consumer (SQS consumer for async graph deletion)
    const graphDeleteConsumer = new lambda.Function(
      this,
      'GraphDeleteConsumer',
      {
        functionName: 'idp-v2-graph-delete-consumer',
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
          path.join(__dirname, '../functions/graph-delete-consumer'),
        ),
        timeout: Duration.minutes(5),
        memorySize: 256,
        architecture: lambda.Architecture.ARM_64,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [graphServiceSg],
        reservedConcurrentExecutions: 1,
        environment: {
          NEPTUNE_ENDPOINT: neptuneEndpoint,
          NEPTUNE_PORT: neptunePort,
          GRAPH_DELETE_QUEUE_URL: graphDeleteQueue.queueUrl,
        },
      },
    );
    graphDeleteConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['neptune-db:*'],
        resources: ['*'],
      }),
    );
    graphDeleteConsumer.addEventSourceMapping('GraphDeleteQueueTrigger', {
      eventSourceArn: graphDeleteQueue.queueArn,
      batchSize: 1,
    });
    graphDeleteQueue.grantConsumeMessages(graphDeleteConsumer);
    graphDeleteQueue.grantSendMessages(graphDeleteConsumer);

    // ========================================
    // Lambda Functions
    // ========================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_14,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        BDA_OUTPUT_BUCKET: this.documentBucket.bucketName,
        BACKEND_TABLE_NAME: backendTableName,
        EMBEDDING_MODEL_ID: models.embedding,
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

    // Segment Prep Finalizer (records step complete after parallel page rendering)
    const segmentPrepFinalizer = new lambda.Function(
      this,
      'SegmentPrepFinalizer',
      {
        ...commonLambdaProps,
        functionName: 'idp-v2-segment-prep-finalizer',
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../functions/step-functions/segment-prep-finalizer',
          ),
        ),
        layers: [sharedLayer],
      },
    );

    // Format Parser (extracts text from PDF/PPTX, runs before waiting for async preprocessing)
    // Docker Lambda for LibreOffice (PPT to PDF conversion)
    const formatParser = new lambda.DockerImageFunction(this, 'FormatParser', {
      functionName: 'idp-v2-format-parser',
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, '../functions'),
        {
          file: 'step-functions/format-parser/Dockerfile',
          platform: Platform.LINUX_ARM64,
        },
      ),
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 2048,
      ephemeralStorageSize: Size.gibibytes(2),
      environment: { ...commonLambdaProps.environment },
    });

    // Check analysis throttle (called after preprocessing completes)
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

    // ========================================
    // Preprocessing Lambda Functions (Step Functions orchestrated)
    // ========================================

    // BDA Start (starts BDA async job)
    const bdaStart = new lambda.Function(this, 'BdaStart', {
      ...commonLambdaProps,
      functionName: 'idp-v2-bda-start',
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/bda-start'),
      ),
      layers: [sharedLayer],
    });

    // BDA Check (checks BDA async job status)
    const bdaCheck = new lambda.Function(this, 'BdaCheck', {
      ...commonLambdaProps,
      functionName: 'idp-v2-bda-check',
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/bda-check'),
      ),
      layers: [sharedLayer],
    });

    // BDA permissions
    for (const fn of [bdaStart, bdaCheck]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'bedrock:InvokeDataAutomationAsync',
            'bedrock:GetDataAutomationStatus',
            'bedrock:ListDataAutomationProjects',
            'bedrock:CreateDataAutomationProject',
          ],
          resources: ['*'],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sts:GetCallerIdentity'],
          resources: ['*'],
        }),
      );
    }

    // Transcribe Start
    const transcribeStart = new lambda.Function(this, 'TranscribeStart', {
      ...commonLambdaProps,
      functionName: 'idp-v2-transcribe-start',
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/transcribe-start'),
      ),
      layers: [sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        TRANSCRIBE_OUTPUT_BUCKET: documentBucketName,
      },
    });

    // Transcribe Check (checks job status + downloads transcript)
    const transcribeCheck = new lambda.Function(this, 'TranscribeCheck', {
      ...commonLambdaProps,
      functionName: 'idp-v2-transcribe-check',
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/transcribe-check'),
      ),
      layers: [sharedLayer],
    });

    // Transcribe permissions
    for (const fn of [transcribeStart, transcribeCheck]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'transcribe:StartTranscriptionJob',
            'transcribe:GetTranscriptionJob',
          ],
          resources: ['*'],
        }),
      );
    }

    // OCR Orchestrator (routes to Lambda/SageMaker, handles PDF chunking)
    const ocrOrchestrator = new lambda.Function(this, 'OcrOrchestrator', {
      ...commonLambdaProps,
      functionName: 'idp-v2-ocr-orchestrator',
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      memorySize: 512,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/ocr-orchestrator'),
        {
          bundling: {
            image: lambda.Runtime.PYTHON_3_14.bundlingImage,
            command: [
              'bash',
              '-c',
              'pip install pypdfium2 -t /asset-output && cp -r /asset-input/* /asset-output/',
            ],
          },
        },
      ),
      layers: [sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        OUTPUT_BUCKET: documentBucketName,
        SAGEMAKER_ENDPOINT_NAME: PADDLEOCR_ENDPOINT_NAME_VALUE,
      },
    });

    // OCR permissions
    ocrOrchestrator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sagemaker:InvokeEndpointAsync'],
        resources: ['*'],
      }),
    );
    ocrOrchestrator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sagemaker:UpdateEndpointWeightsAndCapacities'],
        resources: [
          `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${PADDLEOCR_ENDPOINT_NAME_VALUE}`,
        ],
      }),
    );

    // OCR Check (checks if OCR processing is complete via DDB)
    const ocrCheck = new lambda.Function(this, 'OcrCheck', {
      ...commonLambdaProps,
      functionName: 'idp-v2-ocr-check',
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/ocr-check'),
      ),
      layers: [sharedLayer],
    });

    // OCR Chunk Merger (merges chunk results after Map state)
    const ocrChunkMerger = new lambda.Function(this, 'OcrChunkMerger', {
      ...commonLambdaProps,
      functionName: 'idp-v2-ocr-chunk-merger',
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/ocr-chunk-merger'),
      ),
      layers: [sharedLayer],
    });

    // WebCrawler Invoke (triggers async AgentCore runtime)
    const webcrawlerInvoke = new lambda.Function(this, 'WebcrawlerInvoke', {
      ...commonLambdaProps,
      functionName: 'idp-v2-webcrawler-invoke',
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/webcrawler-invoke'),
      ),
      layers: [sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        WEBCRAWLER_AGENT_RUNTIME_ARN: webcrawlerAgentRuntimeArn,
      },
    });

    // WebCrawler Check (polls DDB for agent completion)
    const webcrawlerCheck = new lambda.Function(this, 'WebcrawlerCheck', {
      ...commonLambdaProps,
      functionName: 'idp-v2-webcrawler-check',
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/webcrawler-check'),
      ),
      layers: [sharedLayer],
    });

    // WebCrawler permissions
    webcrawlerInvoke.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/webcrawler_agent*`,
        ],
      }),
    );

    const segmentBuilder = new lambda.Function(this, 'SegmentBuilder', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-builder',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/segment-builder'),
      ),
      layers: [coreLayer, sharedLayer],
    });

    // Reanalysis Prep (prepares segments for re-analysis)
    const reanalysisPrep = new lambda.Function(this, 'ReanalysisPrep', {
      ...commonLambdaProps,
      functionName: 'idp-v2-reanalysis-prep',
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/reanalysis-prep'),
      ),
      layers: [coreLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
        GRAPH_SERVICE_FUNCTION_NAME: graphService.functionName,
      },
    });

    const segmentAnalyzer = new lambda.Function(this, 'SegmentAnalyzer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-segment-analyzer',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/segment-analyzer'),
      ),
      layers: [coreLayer, strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        BEDROCK_MODEL_ID: models.analysis,
        BEDROCK_VIDEO_MODEL_ID: models.videoAnalysis,
        NOVA_LITE_MODEL_ID: models.scriptExtractor,
        MAX_REASONING_EFFORT: 'low',
        BUCKET_OWNER_ACCOUNT_ID: this.account,
        AGENT_STORAGE_BUCKET_NAME: agentStorageBucketName,
      },
    });

    // Grant segment-analyzer read access to agent storage bucket (for analysis prompts)
    agentStorageBucket.grantRead(segmentAnalyzer);

    const analysisFinalizer = new lambda.Function(this, 'AnalysisFinalizer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-analysis-finalizer',
      handler: 'index.handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/analysis-finalizer'),
      ),
      layers: [strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_WRITE_QUEUE_URL: lancedbWriteQueue.queueUrl,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
        PAGE_DESCRIPTION_MODEL_ID: models.describer,
        ENTITY_EXTRACTION_MODEL_ID: models.extractor,
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
      layers: [strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
        SUMMARIZER_MODEL_ID: models.docSummarizer,
      },
    });

    // GraphBuilder Lambda (builds knowledge graph after segment analysis)
    const graphBuilder = new lambda.Function(this, 'GraphBuilder', {
      ...commonLambdaProps,
      functionName: 'idp-v2-graph-builder',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/graph-builder'),
      ),
      layers: [coreLayer, strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        GRAPH_SERVICE_FUNCTION_NAME: graphService.functionName,
        GRAPH_BUILDER_MODEL_ID: models.extractor,
      },
    });

    // Grant GraphService invoke to GraphBuilder
    graphService.grantInvoke(graphBuilder);

    // Graph Batch Sender (sends graph data to Neptune via graph-service, called by Map)
    const graphBatchSender = new lambda.Function(this, 'GraphBatchSender', {
      ...commonLambdaProps,
      functionName: 'idp-v2-graph-batch-sender',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/graph-batch-sender'),
      ),
      environment: {
        ...commonLambdaProps.environment,
        GRAPH_SERVICE_FUNCTION_NAME: graphService.functionName,
      },
    });
    graphService.grantInvoke(graphBatchSender);

    // Graph Builder Finalizer (records step complete after Map)
    const graphBuilderFinalizer = new lambda.Function(
      this,
      'GraphBuilderFinalizer',
      {
        ...commonLambdaProps,
        functionName: 'idp-v2-graph-builder-finalizer',
        handler: 'index.handler',
        timeout: Duration.minutes(5),
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../functions/step-functions/graph-builder-finalizer',
          ),
        ),
        layers: [sharedLayer],
        environment: {
          ...commonLambdaProps.environment,
          GRAPH_SERVICE_FUNCTION_NAME: graphService.functionName,
        },
      },
    );
    graphService.grantInvoke(graphBuilderFinalizer);

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

    // Workflow Error Handler (centralized error handling for Step Functions)
    const workflowErrorHandler = new lambda.Function(
      this,
      'WorkflowErrorHandler',
      {
        ...commonLambdaProps,
        functionName: 'idp-v2-workflow-error-handler',
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        memorySize: 256,
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../functions/step-functions/workflow-error-handler',
          ),
        ),
        layers: [sharedLayer],
      },
    );

    // Workflow Finalizer (records workflow as COMPLETED after PostAnalysisParallel)
    const workflowFinalizer = new lambda.Function(this, 'WorkflowFinalizer', {
      ...commonLambdaProps,
      functionName: 'idp-v2-workflow-finalizer',
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/step-functions/workflow-finalizer'),
      ),
      layers: [sharedLayer],
    });

    // QA Regenerator Lambda (single Q&A re-generation via Bedrock vision)
    const qaRegenerator = new lambda.Function(this, 'QaRegenerator', {
      ...commonLambdaProps,
      functionName: 'idp-v2-qa-regenerator',
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/qa-regenerator'),
      ),
      layers: [coreLayer, strandsLayer, sharedLayer],
      environment: {
        ...commonLambdaProps.environment,
        BEDROCK_MODEL_ID: models.analysis,
        LANCEDB_FUNCTION_NAME: lancedbService.functionName,
        GRAPH_SERVICE_FUNCTION_NAME: graphService.functionName,
        GRAPH_BUILDER_FUNCTION_NAME: graphBuilder.functionName,
      },
    });

    // Grant LanceDB invoke to QA Regenerator
    lancedbService.grantInvoke(qaRegenerator);
    graphService.grantInvoke(qaRegenerator);
    graphBuilder.grantInvoke(qaRegenerator);

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
      comment:
        'Split document into page-level segments: render each page as an image, extract BDA indexer content, and save segment JSON files to S3',
    });

    // Render pages task (called by Map, reuses segment-prep Lambda in render mode)
    const renderPagesTask = new tasks.LambdaInvoke(this, 'RenderPageBatch', {
      lambdaFunction: segmentPrep,
      outputPath: '$.Payload',
      comment:
        'Render a batch of PDF pages as images using the segment-prep Lambda in render mode',
    });

    // Map state for parallel page rendering
    const renderPagesMap = new sfn.DistributedMap(
      this,
      'RenderPagesInParallel',
      {
        comment:
          'Distributed Map (max 10 concurrency): render PDF pages as images in parallel batches',
        maxConcurrency: 10,
        itemsPath: '$.render_batches',
        resultPath: sfn.JsonPath.DISCARD,
        itemSelector: {
          mode: 'render_pages',
          'file_uri.$': '$.file_uri',
          'start_page.$': '$$.Map.Item.Value.start_page',
          'end_page.$': '$$.Map.Item.Value.end_page',
        },
        mapExecutionType: sfn.StateMachineType.STANDARD,
      },
    );
    renderPagesMap.itemProcessor(renderPagesTask);

    // Finalize segment prep (record step_complete after rendering)
    const finalizeSegmentPrepTask = new tasks.LambdaInvoke(
      this,
      'FinalizeSegmentPrep',
      {
        lambdaFunction: segmentPrepFinalizer,
        outputPath: '$.Payload',
        comment:
          'Record segment preparation step as complete in DynamoDB and return segment count and metadata URI',
      },
    );

    // Choice: skip rendering for non-PDF files
    const renderChoice = new sfn.Choice(this, 'NeedRendering', {
      comment:
        'Check render_needed flag: if true, render PDF pages as images via Map; if false, skip rendering (non-PDF files)',
    })
      .when(
        sfn.Condition.booleanEquals('$.render_needed', true),
        renderPagesMap.next(finalizeSegmentPrepTask),
      )
      .otherwise(
        new sfn.Pass(this, 'SkipRendering', {
          comment: 'Non-PDF file: page rendering not needed, skip to next step',
        }),
      );

    // Chain: PrepareSegments → Choice → (Map → Finalize, or Skip)
    const segmentPrepChain = segmentPrepTask.next(renderChoice);

    const formatParserTask = new tasks.LambdaInvoke(this, 'ParseFormat', {
      lambdaFunction: formatParser,
      outputPath: '$.Payload',
      comment:
        'Extract raw text from document using format-specific parsers (PDF text extraction, DOCX/PPTX conversion). Runs independently from BDA/OCR',
    });

    const checkAnalysisThrottleTask = new tasks.LambdaInvoke(
      this,
      'CheckAnalysisThrottle',
      {
        lambdaFunction: checkPreprocessStatus,
        outputPath: '$.Payload',
        comment:
          'Check if another workflow AI analysis is already running (DDB GSI1SK=in_progress). Prevents concurrent Bedrock API overload',
      },
    );

    // Preprocessing SFN tasks
    const bdaStartTask = new tasks.LambdaInvoke(this, 'StartBda', {
      lambdaFunction: bdaStart,
      outputPath: '$.Payload',
      comment:
        'Start Bedrock Data Automation async job for document analysis. Returns invocation ARN for status polling',
    });

    const bdaCheckTask = new tasks.LambdaInvoke(this, 'CheckBda', {
      lambdaFunction: bdaCheck,
      outputPath: '$.Payload',
      comment:
        'Check BDA async job status via GetDataAutomationStatus API. Returns bda_status (IN_PROGRESS, SUCCESS, or FAILED)',
    });

    const transcribeStartTask = new tasks.LambdaInvoke(
      this,
      'StartTranscribe',
      {
        lambdaFunction: transcribeStart,
        outputPath: '$.Payload',
        comment:
          'Start AWS Transcribe job for audio/video files. Returns job name for status polling',
      },
    );

    const transcribeCheckTask = new tasks.LambdaInvoke(
      this,
      'CheckTranscribe',
      {
        lambdaFunction: transcribeCheck,
        outputPath: '$.Payload',
        comment:
          'Check Transcribe job status and download transcript when complete',
      },
    );

    const ocrOrchestratorTask = new tasks.LambdaInvoke(this, 'OrchestrateOcr', {
      lambdaFunction: ocrOrchestrator,
      outputPath: '$.Payload',
      comment:
        'Determine OCR backend (Lambda or SageMaker), split PDF into chunks of N pages, and prepare chunk manifest for parallel processing',
    });

    const ocrCheckTask = new tasks.LambdaInvoke(this, 'CheckOcr', {
      lambdaFunction: ocrCheck,
      outputPath: '$.Payload',
      comment:
        'Check SageMaker async inference status and download results when complete',
    });

    const ocrChunkMergerTask = new tasks.LambdaInvoke(this, 'MergeOcrChunks', {
      lambdaFunction: ocrChunkMerger,
      outputPath: '$.Payload',
      comment:
        'Merge OCR results from all chunks into a single output, ordered by page number. Called after all Lambda chunks complete',
    });

    const webcrawlerInvokeTask = new tasks.LambdaInvoke(
      this,
      'InvokeWebCrawler',
      {
        lambdaFunction: webcrawlerInvoke,
        outputPath: '$.Payload',
        comment:
          'Trigger Bedrock AgentCore Runtime to start async web crawling. Returns immediately with IN_PROGRESS status',
      },
    );

    const webcrawlerCheckTask = new tasks.LambdaInvoke(
      this,
      'CheckWebCrawler',
      {
        lambdaFunction: webcrawlerCheck,
        outputPath: '$.Payload',
        comment:
          'Poll DDB for webcrawler agent completion status. Agent updates DDB when crawling finishes',
      },
    );

    const segmentBuilderTask = new tasks.LambdaInvoke(this, 'BuildSegments', {
      lambdaFunction: segmentBuilder,
      outputPath: '$.Payload',
      comment:
        'Build analysis-ready segments: count existing segments from S3, prepare segment_ids array for distributed Map processing',
    });

    const reanalysisPrepTask = new tasks.LambdaInvoke(
      this,
      'PrepareReanalysis',
      {
        lambdaFunction: reanalysisPrep,
        outputPath: '$.Payload',
        comment:
          'Prepare for re-analysis: reset analysis steps to pending, delete existing LanceDB vectors and graph data, clear ai_analysis from S3 segments, save user instructions',
      },
    );

    const segmentAnalyzerTask = new tasks.LambdaInvoke(this, 'AnalyzeSegment', {
      lambdaFunction: segmentAnalyzer,
      outputPath: '$.Payload',
      comment:
        'Run AI analysis on a single segment using Bedrock Claude: generate Q&A pairs from BDA/OCR/text content with document prompt and language settings',
    });
    segmentAnalyzerTask.addRetry({
      errors: [
        'ThrottlingException',
        'TooManyRequestsException',
        'ServiceUnavailableException',
        'Lambda.TooManyRequestsException',
      ],
      interval: Duration.seconds(10),
      maxAttempts: 2,
      backoffRate: 2,
      jitterStrategy: sfn.JitterType.FULL,
    });

    const analysisFinalizerTask = new tasks.LambdaInvoke(
      this,
      'FinalizeAnalysis',
      {
        lambdaFunction: analysisFinalizer,
        outputPath: '$.Payload',
        comment:
          'Persist segment analysis to DDB, send to LanceDB writer SQS for vector indexing, and notify progress via WebSocket',
      },
    );

    const documentSummarizerTask = new tasks.LambdaInvoke(
      this,
      'SummarizeDocument',
      {
        lambdaFunction: documentSummarizer,
        outputPath: '$.Payload',
        comment:
          'Generate a comprehensive document summary using Bedrock Claude based on all segment analyses. Updates workflow status to completed',
        payload: sfn.TaskInput.fromObject({
          'workflow_id.$': '$.workflow_id',
          'document_id.$': '$.document_id',
          'project_id.$': '$.project_id',
          'file_uri.$': '$.file_uri',
          'file_type.$': '$.file_type',
          'segment_count.$': '$.segment_count',
        }),
      },
    );

    // PrepareGraph: load segments, deduplicate, save work to S3
    const graphBuilderTask = new tasks.LambdaInvoke(
      this,
      'BuildKnowledgeGraph',
      {
        lambdaFunction: graphBuilder,
        outputPath: '$.Payload',
        comment:
          'Load all segment analyses, extract entities and relationships, deduplicate, and split into batch files on S3 for sequential Neptune ingestion',
      },
    );

    // SendGraphBatch: send one batch file to graph-service
    const graphBatchSenderTask = new tasks.LambdaInvoke(
      this,
      'SendGraphBatch',
      {
        lambdaFunction: graphBatchSender,
        outputPath: '$.Payload',
        comment:
          'Send one batch of entities/relationships to the graph service Lambda for Neptune upsert',
      },
    );

    // Map over graph batches (sequential to avoid Neptune overload)
    const sendGraphBatchesMap = new sfn.Map(this, 'SendGraphBatches', {
      comment:
        'Iterate over graph batch files sequentially (maxConcurrency=1) to avoid overwhelming Neptune with concurrent writes',
      maxConcurrency: 1,
      itemsPath: '$.graph_batches',
      resultPath: sfn.JsonPath.DISCARD,
      itemSelector: {
        'action.$': '$$.Map.Item.Value.action',
        'item_key.$': '$$.Map.Item.Value.item_key',
        's3_key.$': '$$.Map.Item.Value.s3_key',
        'batch_size.$': '$$.Map.Item.Value.batch_size',
        'extra_params.$': '$$.Map.Item.Value.extra_params',
        's3_bucket.$': '$.s3_bucket',
      },
    });
    sendGraphBatchesMap.itemProcessor(graphBatchSenderTask);

    // FinalizeGraph: record step complete
    const graphBuilderFinalizerTask = new tasks.LambdaInvoke(
      this,
      'FinalizeGraph',
      {
        lambdaFunction: graphBuilderFinalizer,
        outputPath: '$.Payload',
        comment:
          'Record graph builder step completion in DDB and send WebSocket notification',
      },
    );

    // Chain: PrepareGraph → SendGraphBatches(Map) → FinalizeGraph
    const graphBuilderChain = graphBuilderTask
      .next(sendGraphBatchesMap)
      .next(graphBuilderFinalizerTask);

    const errorHandlerTask = new tasks.LambdaInvoke(
      this,
      'HandleWorkflowError',
      {
        lambdaFunction: workflowErrorHandler,
        outputPath: '$.Payload',
        comment:
          'Catch-all error handler: update workflow/document status to failed in DDB, send error notification via WebSocket, and log error details',
      },
    );

    const workflowFailed = new sfn.Fail(this, 'WorkflowFailed', {
      comment:
        'Terminal failure state after error handler has recorded the failure',
      cause: 'Workflow failed',
      error: 'WORKFLOW_FAILED',
    });

    errorHandlerTask.next(workflowFailed);

    // Add catch to all task states
    const catchConfig: sfn.CatchProps = {
      resultPath: '$.error_info',
    };

    // Catch on top-level tasks (not inside Parallel/Map)
    checkAnalysisThrottleTask.addCatch(errorHandlerTask, catchConfig);
    segmentBuilderTask.addCatch(errorHandlerTask, catchConfig);
    reanalysisPrepTask.addCatch(errorHandlerTask, catchConfig);

    // ========================================
    // Segment Processing
    // ========================================

    // Segment processing chain: Analyze → Finalize
    // For re-analysis, pass is_reanalysis flag to AnalysisFinalizer
    const segmentProcessing = segmentAnalyzerTask.next(analysisFinalizerTask);

    // Distributed Map for parallel segment processing
    const parallelSegmentProcessing = new sfn.DistributedMap(
      this,
      'ProcessSegmentsInParallel',
      {
        comment:
          'Distributed Map over segment_ids array: run AnalyzeSegment + FinalizeAnalysis per segment with up to 30 concurrent child executions',
        maxConcurrency: 30,
        itemsPath: '$.segment_ids',
        resultPath: sfn.JsonPath.DISCARD,
        itemSelector: {
          'workflow_id.$': '$.workflow_id',
          'project_id.$': '$.project_id',
          'document_id.$': '$.document_id',
          'file_uri.$': '$.file_uri',
          'file_type.$': '$.file_type',
          'segment_count.$': '$.segment_count',
          'language.$': '$.language',
          'document_prompt.$': '$.document_prompt',
          'segment_index.$': '$$.Map.Item.Value',
          'is_reanalysis.$': '$.is_reanalysis',
        },
        mapExecutionType: sfn.StateMachineType.STANDARD,
      },
    );
    parallelSegmentProcessing.itemProcessor(segmentProcessing, {
      mode: sfn.ProcessorMode.DISTRIBUTED,
      executionType: sfn.ProcessorType.STANDARD,
    });
    parallelSegmentProcessing.addCatch(errorHandlerTask, catchConfig);

    // ========================================
    // Preprocessing Branches (Step Functions orchestrated)
    // ========================================

    // --- BDA Branch ---
    const bdaWait = new sfn.Wait(this, 'WaitForBda', {
      comment: 'Wait 10 seconds before polling BDA job status again',
      time: sfn.WaitTime.duration(Duration.seconds(10)),
    });
    const bdaStatusChoice = new sfn.Choice(this, 'BdaStatusChoice', {
      comment:
        'If BDA job is still IN_PROGRESS, loop back to wait; otherwise proceed to BdaDone',
    })
      .when(sfn.Condition.stringEquals('$.bda_status', 'IN_PROGRESS'), bdaWait)
      .otherwise(
        new sfn.Pass(this, 'BdaDone', {
          comment: 'BDA processing complete (SUCCESS or FAILED)',
        }),
      );
    bdaWait.next(bdaCheckTask);
    bdaCheckTask.next(bdaStatusChoice);
    const bdaBranch = new sfn.Choice(this, 'ShouldRunBda', {
      comment:
        'Check use_bda flag from input: if true, start BDA async job; if false, skip entirely',
    })
      .when(
        sfn.Condition.booleanEquals('$.use_bda', true),
        bdaStartTask.next(bdaWait),
      )
      .otherwise(
        new sfn.Pass(this, 'SkipBda', {
          comment: 'BDA not requested for this document type',
        }),
      );

    // --- OCR Branch ---
    // Map state: invoke OCR Lambda processor per chunk (parallel)
    const ocrChunkMap = new sfn.DistributedMap(this, 'OcrChunkMap', {
      comment:
        'Distributed Map over PDF chunks: invoke OCR Lambda processor per chunk with up to 40 concurrent executions for fast parallel OCR',
      itemsPath: '$.ocr_chunks',
      resultPath: sfn.JsonPath.DISCARD,
      maxConcurrency: 40,
      mapExecutionType: sfn.StateMachineType.STANDARD,
    });
    const ocrChunkInvokeTask = new tasks.LambdaInvoke(this, 'InvokeOcrChunk', {
      lambdaFunction: ocrLambdaProcessor,
      outputPath: '$.Payload',
      comment:
        'Run PaddleOCR on a single PDF chunk via Lambda processor and save results to S3',
    });
    ocrChunkMap.itemProcessor(ocrChunkInvokeTask);

    // SageMaker polling loop (async inference)
    const ocrWait = new sfn.Wait(this, 'WaitForOcr', {
      comment:
        'Wait 15 seconds before polling SageMaker async inference status',
      time: sfn.WaitTime.duration(Duration.seconds(15)),
    });
    const ocrStatusChoice = new sfn.Choice(this, 'OcrStatusChoice', {
      comment:
        'If SageMaker OCR job is still IN_PROGRESS, loop back to wait; otherwise proceed to OcrDone',
    })
      .when(sfn.Condition.stringEquals('$.ocr_status', 'IN_PROGRESS'), ocrWait)
      .otherwise(
        new sfn.Pass(this, 'OcrDone', {
          comment: 'SageMaker OCR processing complete',
        }),
      );
    ocrWait.next(ocrCheckTask);
    ocrCheckTask.next(ocrStatusChoice);

    // Route based on ocr_backend after orchestrator
    const ocrBackendChoice = new sfn.Choice(this, 'OcrBackendChoice', {
      comment:
        'Route OCR processing based on backend: "lambda" runs parallel chunk Map then merge; "sagemaker" enters async polling loop',
    })
      .when(
        sfn.Condition.stringEquals('$.ocr_backend', 'lambda'),
        ocrChunkMap.next(ocrChunkMergerTask),
      )
      .otherwise(ocrWait);

    const ocrBranch = new sfn.Choice(this, 'ShouldRunOcr', {
      comment:
        'Check use_ocr flag from input: if true, run OCR orchestration; if false, skip entirely',
    })
      .when(
        sfn.Condition.booleanEquals('$.use_ocr', true),
        ocrOrchestratorTask.next(ocrBackendChoice),
      )
      .otherwise(
        new sfn.Pass(this, 'SkipOcr', {
          comment: 'OCR not requested for this document type',
        }),
      );

    // --- Transcribe Branch ---
    const transcribeWait = new sfn.Wait(this, 'WaitForTranscribe', {
      comment: 'Wait 10 seconds before polling Transcribe job status again',
      time: sfn.WaitTime.duration(Duration.seconds(10)),
    });
    const transcribeStatusChoice = new sfn.Choice(
      this,
      'TranscribeStatusChoice',
      {
        comment:
          'If Transcribe job is still IN_PROGRESS, loop back to wait; otherwise proceed to TranscribeDone',
      },
    )
      .when(
        sfn.Condition.stringEquals('$.transcribe_status', 'IN_PROGRESS'),
        transcribeWait,
      )
      .otherwise(
        new sfn.Pass(this, 'TranscribeDone', {
          comment: 'Transcribe processing complete',
        }),
      );
    transcribeWait.next(transcribeCheckTask);
    transcribeCheckTask.next(transcribeStatusChoice);
    const transcribeBranch = new sfn.Choice(this, 'ShouldRunTranscribe', {
      comment:
        'Check use_transcribe flag from input: if true, start Transcribe job; if false, skip entirely',
    })
      .when(
        sfn.Condition.booleanEquals('$.use_transcribe', true),
        transcribeStartTask.next(transcribeWait),
      )
      .otherwise(
        new sfn.Pass(this, 'SkipTranscribe', {
          comment: 'Transcribe not requested for this document type',
        }),
      );

    // --- WebCrawler Branch ---
    // --- WebCrawler polling loop ---
    const webcrawlerWait = new sfn.Wait(this, 'WaitForWebCrawler', {
      comment: 'Wait 10 seconds before polling webcrawler agent status again',
      time: sfn.WaitTime.duration(Duration.seconds(10)),
    });
    const webcrawlerStatusChoice = new sfn.Choice(
      this,
      'WebCrawlerStatusChoice',
      {
        comment:
          'If webcrawler agent is still IN_PROGRESS, loop back to wait; otherwise proceed to WebCrawlerDone',
      },
    )
      .when(
        sfn.Condition.stringEquals('$.webcrawler_status', 'IN_PROGRESS'),
        webcrawlerWait,
      )
      .otherwise(
        new sfn.Pass(this, 'WebCrawlerDone', {
          comment: 'Web crawling complete',
        }),
      );
    webcrawlerWait.next(webcrawlerCheckTask);
    webcrawlerCheckTask.next(webcrawlerStatusChoice);

    const webcrawlerBranch = new sfn.Choice(this, 'ShouldRunWebCrawler', {
      comment:
        'Check processing_type: if "web", invoke web crawler then poll for completion; otherwise skip',
    })
      .when(
        sfn.Condition.stringEquals('$.processing_type', 'web'),
        webcrawlerInvokeTask.next(webcrawlerWait),
      )
      .otherwise(
        new sfn.Pass(this, 'SkipWebCrawler', {
          comment: 'Not a web document, skip web crawling',
        }),
      );

    // ========================================
    // Analysis Throttle Loop
    // ========================================

    const waitForAnalysisSlot = new sfn.Wait(this, 'WaitForAnalysisSlot', {
      comment:
        'Wait 10 seconds before rechecking if another workflow analysis is still running',
      time: sfn.WaitTime.duration(Duration.seconds(10)),
    });

    const analysisThrottleChoice = new sfn.Choice(
      this,
      'AnalysisThrottleChoice',
      {
        comment:
          'If analysis_busy is true (another workflow is mid-analysis), loop back to wait; otherwise proceed to segment building',
      },
    )
      .when(
        sfn.Condition.booleanEquals('$.preprocess_check.analysis_busy', true),
        waitForAnalysisSlot,
      )
      .otherwise(segmentBuilderTask);

    waitForAnalysisSlot.next(checkAnalysisThrottleTask);
    checkAnalysisThrottleTask.next(analysisThrottleChoice);

    // Workflow Finalizer task (records workflow COMPLETED after all branches done)
    const workflowFinalizerTask = new tasks.LambdaInvoke(
      this,
      'FinalizeWorkflow',
      {
        lambdaFunction: workflowFinalizer,
        outputPath: '$.Payload',
        comment:
          'Mark workflow as completed in DDB, update document status, and send final WebSocket notification to connected clients',
      },
    );
    workflowFinalizerTask.addCatch(errorHandlerTask, catchConfig);

    // Post-analysis: GraphBuilder and Summarizer run in parallel (independent)
    const postAnalysisParallel = new sfn.Parallel(
      this,
      'PostAnalysisParallel',
      {
        comment:
          'Run knowledge graph building and document summarization in parallel since they are independent post-analysis tasks',
        resultPath: sfn.JsonPath.DISCARD,
      },
    );
    postAnalysisParallel.branch(graphBuilderChain);
    postAnalysisParallel.branch(documentSummarizerTask);
    postAnalysisParallel.addCatch(errorHandlerTask, catchConfig);

    // Chain: SegmentBuilder → Map(Analyze) → Parallel(GraphBuilder, Summarize) → FinalizeWorkflow
    segmentBuilderTask
      .next(parallelSegmentProcessing)
      .next(postAnalysisParallel)
      .next(workflowFinalizerTask);

    // ========================================
    // Main Workflow Definition
    // ========================================

    // Parallel execution of all preprocessing branches
    const parallelPreprocessing = new sfn.Parallel(
      this,
      'ParallelPreprocessing',
      {
        comment:
          'Run all 6 preprocessing branches in parallel: SegmentPrep, FormatParser, BDA, OCR, Transcribe, WebCrawler. Each branch skips if not applicable. Results are merged via resultSelector',
        resultSelector: {
          'workflow_id.$': '$[0].workflow_id',
          'project_id.$': '$[0].project_id',
          'document_id.$': '$[0].document_id',
          'file_uri.$': '$[0].file_uri',
          'file_type.$': '$[0].file_type',
          'preprocessor_metadata_uri.$': '$[0].preprocessor_metadata_uri',
          'segment_count.$': '$[0].segment_count',
          'language.$': '$[0].language',
          'document_prompt.$': '$[0].document_prompt',
          'format_parser.$': '$[1].format_parser',
          'is_reanalysis.$': '$$.Execution.Input.is_reanalysis',
          'use_bda.$': '$$.Execution.Input.use_bda',
          'use_ocr.$': '$$.Execution.Input.use_ocr',
          'use_transcribe.$': '$$.Execution.Input.use_transcribe',
        },
      },
    );
    parallelPreprocessing.branch(segmentPrepChain);
    parallelPreprocessing.branch(formatParserTask);
    parallelPreprocessing.branch(bdaBranch);
    parallelPreprocessing.branch(ocrBranch);
    parallelPreprocessing.branch(transcribeBranch);
    parallelPreprocessing.branch(webcrawlerBranch);
    parallelPreprocessing.addCatch(errorHandlerTask, catchConfig);

    // Flow: Parallel(SegmentPrep, FormatParser, BDA, OCR, Transcribe, WebCrawler)
    //       → CheckAnalysisThrottle → SegmentBuilder → Map(Analyze) → Summarize
    parallelPreprocessing.next(checkAnalysisThrottleTask);

    // Re-analysis flow: Skip preprocessing, go directly to analysis
    // ReanalysisPrep → Map(Analyze) → Summarize
    reanalysisPrepTask.next(parallelSegmentProcessing);

    // Choice at workflow start: check if this is a re-analysis request
    const isReanalysisChoice = new sfn.Choice(this, 'IsReanalysis', {
      comment:
        'Entry point: if is_reanalysis=true, skip all preprocessing and go directly to ReanalysisPrep; otherwise run full preprocessing pipeline',
    })
      .when(
        sfn.Condition.booleanEquals('$.is_reanalysis', true),
        reanalysisPrepTask,
      )
      .otherwise(parallelPreprocessing);

    const definition = isReanalysisChoice;

    this.stateMachine = new sfn.StateMachine(
      this,
      'DocumentAnalysisStateMachine',
      {
        stateMachineName: 'idp-v2-document-analysis',
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.hours(24),
      },
    );

    // Grant state machine permission to invoke OCR Lambda processor (Map state)
    ocrLambdaProcessor.grantInvoke(this.stateMachine);

    // ========================================
    // Workflow Failure Catcher (EventBridge → Lambda)
    // ========================================

    const workflowFailureCatcher = new lambda.Function(
      this,
      'WorkflowFailureCatcher',
      {
        ...commonLambdaProps,
        functionName: 'idp-v2-workflow-failure-catcher',
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        memorySize: 256,
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../functions/step-functions/workflow-failure-catcher',
          ),
        ),
        layers: [sharedLayer],
      },
    );

    // Grant describe execution permission
    this.stateMachine.grant(workflowFailureCatcher, 'states:DescribeExecution');
    backendTable.grantReadWriteData(workflowFailureCatcher);
    (this.documentBucket as s3.Bucket).grantRead(workflowFailureCatcher);

    // EventBridge rule: catch SFN execution failures
    new events.Rule(this, 'WorkflowFailureRule', {
      ruleName: 'idp-v2-workflow-failure',
      description:
        'Catch Step Functions execution failures (FAILED, TIMED_OUT, ABORTED)',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: [this.stateMachine.stateMachineArn],
          status: ['FAILED', 'TIMED_OUT', 'ABORTED'],
        },
      },
      targets: [new eventsTargets.LambdaFunction(workflowFailureCatcher)],
    });

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
      segmentPrepFinalizer,
      formatParser,
      checkPreprocessStatus,
      segmentBuilder,
      reanalysisPrep,
      segmentAnalyzer,
      analysisFinalizer,
      documentSummarizer,
      graphBuilder,
      graphBatchSender,
      graphBuilderFinalizer,
      workflowErrorHandler,
      workflowFinalizer,
      workflowFailureCatcher,
      triggerFunction,
      lancedbService,
      lancedbWriter,
      qaRegenerator,
      bdaStart,
      bdaCheck,
      transcribeStart,
      transcribeCheck,
      ocrOrchestrator,
      ocrCheck,
      ocrChunkMerger,
      webcrawlerInvoke,
      webcrawlerCheck,
    ];

    // Grant invoke permissions for LanceDB service
    lancedbService.grantInvoke(lancedbWriter);
    lancedbService.grantInvoke(documentSummarizer);
    lancedbService.grantInvoke(analysisFinalizer);
    lancedbService.grantInvoke(reanalysisPrep);
    graphService.grantInvoke(reanalysisPrep);

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

      // DynamoDB permissions for Backend table (workflow state) + GSI indexes
      backendTable.grantReadWriteData(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:Query'],
          resources: [`${backendTable.tableArn}/index/*`],
        }),
      );

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

    new ssm.StringParameter(this, 'QaRegeneratorFunctionArn', {
      parameterName: SSM_KEYS.QA_REGENERATOR_FUNCTION_ARN,
      stringValue: qaRegenerator.functionArn,
    });

    new ssm.StringParameter(this, 'LanceDBFunctionArn', {
      parameterName: SSM_KEYS.LANCEDB_FUNCTION_ARN,
      stringValue: lancedbService.functionArn,
    });

    new ssm.StringParameter(this, 'GraphServiceFunctionArn', {
      parameterName: SSM_KEYS.GRAPH_SERVICE_FUNCTION_ARN,
      stringValue: graphService.functionArn,
    });

    new ssm.StringParameter(this, 'GraphDeleteQueueUrl', {
      parameterName: SSM_KEYS.GRAPH_DELETE_QUEUE_URL,
      stringValue: graphDeleteQueue.queueUrl,
    });
  }
}
