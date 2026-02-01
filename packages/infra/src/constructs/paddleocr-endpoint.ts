import { CfnOutput, CustomResource, Duration } from 'aws-cdk-lib';
import {
  CfnModel,
  CfnEndpointConfig,
  CfnEndpoint,
} from 'aws-cdk-lib/aws-sagemaker';
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  ManagedPolicy,
  Policy,
} from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { ITopic } from 'aws-cdk-lib/aws-sns';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { PADDLEOCR_ENDPOINT_NAME_VALUE } from ':idp-v2/common-constructs';

export interface PaddleOcrEndpointProps {
  /**
   * S3 bucket for model artifacts and async inference output
   */
  bucket: Bucket;
  /**
   * S3 bucket for document storage (input images)
   */
  documentBucket?: Bucket;
  /**
   * Docker image URI
   */
  imageUri: string;
  /**
   * S3 URL for model.tar.gz
   */
  modelDataUrl: string;
  /**
   * Instance type for SageMaker endpoint
   * @default 'ml.g5.xlarge'
   */
  instanceType?: string;
  /**
   * Build trigger custom resource to ensure Docker image is ready
   */
  buildTrigger?: CustomResource;
  /**
   * Enable auto-scaling with min=0 for cost optimization
   * @default true
   */
  enableAutoScaling?: boolean;
  /**
   * Minimum instance count for auto-scaling
   * @default 0
   */
  minCapacity?: number;
  /**
   * Maximum instance count for auto-scaling
   * @default 1
   */
  maxCapacity?: number;
  /**
   * SNS Topic for async inference success notifications
   */
  successTopic?: ITopic;
  /**
   * SNS Topic for async inference failure notifications
   */
  errorTopic?: ITopic;
}

export class PaddleOcrEndpoint extends Construct {
  public readonly endpointName: string;
  public readonly endpoint: CfnEndpoint;
  public readonly executionRole: Role;

  constructor(scope: Construct, id: string, props: PaddleOcrEndpointProps) {
    super(scope, id);

    // Execution Role for SageMaker
    this.executionRole = new Role(this, 'ExecutionRole', {
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });

    // Build S3 resources list
    const s3Resources = [props.bucket.bucketArn, `${props.bucket.bucketArn}/*`];
    if (props.documentBucket) {
      s3Resources.push(
        props.documentBucket.bucketArn,
        `${props.documentBucket.bucketArn}/*`,
      );
    }

    // Create explicit policy with all permissions
    const executionPolicy = new Policy(this, 'ExecutionPolicy', {
      roles: [this.executionRole],
      statements: [
        // S3 access for model artifacts and document buckets
        new PolicyStatement({
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:ListBucket',
          ],
          resources: s3Resources,
        }),
        // ECR access for custom image
        new PolicyStatement({
          actions: [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage',
          ],
          resources: ['*'],
        }),
      ],
    });

    // SageMaker Model (no fixed name to allow replacement)
    const model = new CfnModel(this, 'Model', {
      executionRoleArn: this.executionRole.roleArn,
      primaryContainer: {
        image: props.imageUri,
        modelDataUrl: props.modelDataUrl,
        mode: 'SingleModel',
        environment: {
          SAGEMAKER_PROGRAM: 'inference.py',
          PADDLEOCR_HOME: '/tmp/.paddleocr',
          MODEL_CACHE_BUCKET: props.bucket.bucketName,
          MODEL_CACHE_PREFIX: 'paddleocr/models',
          TS_DEFAULT_RESPONSE_TIMEOUT: '3600',
          TS_MAX_RESPONSE_SIZE: '104857600',
          SAGEMAKER_MODEL_SERVER_TIMEOUT: '3600',
          SAGEMAKER_MODEL_SERVER_WORKERS: '1',
        },
      },
    });

    // Ensure policy is created before the model
    model.node.addDependency(executionPolicy);

    // Ensure build is complete before model creation
    if (props.buildTrigger) {
      model.node.addDependency(props.buildTrigger);
    }

    // Add SNS publish permissions if topics are provided
    if (props.successTopic || props.errorTopic) {
      const snsResources: string[] = [];
      if (props.successTopic) snsResources.push(props.successTopic.topicArn);
      if (props.errorTopic) snsResources.push(props.errorTopic.topicArn);

      this.executionRole.addToPolicy(
        new PolicyStatement({
          actions: ['sns:Publish'],
          resources: snsResources,
        }),
      );
    }

    // Build notification config if topics are provided
    const notificationConfig =
      props.successTopic || props.errorTopic
        ? {
            ...(props.successTopic && {
              successTopic: props.successTopic.topicArn,
            }),
            ...(props.errorTopic && { errorTopic: props.errorTopic.topicArn }),
          }
        : undefined;

    // Endpoint Config with Async Inference (no fixed name to allow replacement)
    const endpointConfig = new CfnEndpointConfig(this, 'EndpointConfig', {
      productionVariants: [
        {
          modelName: model.attrModelName,
          variantName: 'AllTraffic',
          initialInstanceCount: 1,
          instanceType: props.instanceType || 'ml.g5.xlarge',
        },
      ],
      asyncInferenceConfig: {
        outputConfig: {
          s3OutputPath: `s3://${props.bucket.bucketName}/paddleocr/output/`,
          s3FailurePath: `s3://${props.bucket.bucketName}/paddleocr/failure/`,
          ...(notificationConfig && { notificationConfig }),
        },
        clientConfig: {
          maxConcurrentInvocationsPerInstance: 1,
        },
      },
    });

    endpointConfig.addDependency(model);

    // SageMaker Endpoint
    this.endpoint = new CfnEndpoint(this, 'Endpoint', {
      endpointName: PADDLEOCR_ENDPOINT_NAME_VALUE,
      endpointConfigName: endpointConfig.attrEndpointConfigName,
    });

    this.endpoint.addDependency(endpointConfig);
    this.endpointName = this.endpoint.attrEndpointName;

    // Auto-scaling configuration (default enabled with min=0)
    const enableAutoScaling = props.enableAutoScaling ?? true;
    if (enableAutoScaling) {
      const minCapacity = props.minCapacity ?? 0;
      const maxCapacity = props.maxCapacity ?? 1;
      // scaleInCooldownMinutes is no longer used - scale-in handled by OCR Complete Handler

      // Create scalable target
      const scalableTarget = new appscaling.ScalableTarget(
        this,
        'ScalableTarget',
        {
          serviceNamespace: appscaling.ServiceNamespace.SAGEMAKER,
          resourceId: `endpoint/${this.endpoint.endpointName}/variant/AllTraffic`,
          scalableDimension: 'sagemaker:variant:DesiredInstanceCount',
          minCapacity,
          maxCapacity,
        },
      );

      // Ensure endpoint is created before scaling target
      scalableTarget.node.addDependency(this.endpoint);

      // Scale OUT based on SageMaker backlog (HasBacklogWithoutCapacity)
      // Note: SQS queue depth doesn't work because Lambda consumes messages
      // faster than CloudWatch can detect them (< 1 second vs 1 minute period)
      const backlogMetric = new cloudwatch.Metric({
        namespace: 'AWS/SageMaker',
        metricName: 'HasBacklogWithoutCapacity',
        dimensionsMap: {
          EndpointName: this.endpoint.endpointName!,
        },
        statistic: 'Average',
        period: Duration.minutes(1),
      });

      // Step scaling policy for scale-out (when backlog exists)
      scalableTarget.scaleOnMetric('ScaleOnBacklog', {
        metric: backlogMetric,
        scalingSteps: [
          { upper: 0, change: 0 }, // No backlog, no change
          { lower: 1, change: +1 }, // Backlog exists, scale up
        ],
        adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: Duration.minutes(1),
      });

      // Scale-in is handled by OCR Complete Handler (immediate)
      // Fallback: CloudWatch alarm in ocr-stack.ts (10 min)
    }

    // Outputs
    new CfnOutput(this, 'EndpointName', {
      value: this.endpointName,
      description: 'SageMaker Endpoint Name for PaddleOCR',
    });
  }
}
