import { Construct } from 'constructs';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { RuntimeConfig } from '../../core/runtime-config.js';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { SSM_KEYS } from '../../constants/ssm-keys.js';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Table, ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IVpc, SubnetType, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  AwsLogDriver,
  Cluster,
  ContainerImage,
  CpuArchitecture,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import {
  HttpApi,
  HttpMethod,
  VpcLink,
  CorsHttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpAlbIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Grant, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { CfnApi } from 'aws-cdk-lib/aws-apigatewayv2';

function getBucketFromSsm(
  scope: Construct,
  id: string,
  ssmKey: string,
): { bucket: IBucket; bucketName: string } {
  const bucketName = StringParameter.valueForStringParameter(scope, ssmKey);
  const bucket = Bucket.fromBucketName(scope, id, bucketName);
  return { bucket, bucketName };
}

function getTableFromSsm(
  scope: Construct,
  id: string,
  ssmKey: string,
): { table: ITable; tableName: string } {
  const tableName = StringParameter.valueForStringParameter(scope, ssmKey);
  const table = Table.fromTableName(scope, id, tableName);
  return { table, tableName };
}

export interface BackendProps {
  vpc: IVpc;
}

export class Backend extends Construct {
  public readonly service: ApplicationLoadBalancedFargateService;
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: BackendProps) {
    super(scope, id);

    const { vpc } = props;

    const cluster = new Cluster(this, 'Cluster', {
      vpc,
    });

    const logGroup = new LogGroup(this, 'BackendLogGroup', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const lancedbStorage = getBucketFromSsm(
      this,
      'LancedbStorageBucket',
      SSM_KEYS.LANCEDB_STORAGE_BUCKET_NAME,
    );
    const documentStorage = getBucketFromSsm(
      this,
      'DocumentStorageBucket',
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const lancedbLockTable = getTableFromSsm(
      this,
      'LancedbLockTable',
      SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
    );
    const backendTable = getTableFromSsm(
      this,
      'BackendTable',
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const lancedbExpressBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
    );
    const websocketEndpoint = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_ENDPOINT,
    );
    const sessionStorage = getBucketFromSsm(
      this,
      'SessionStorageBucket',
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    this.service = new ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      taskImageOptions: {
        image: ContainerImage.fromAsset('../backend', {
          platform: Platform.LINUX_ARM64,
        }),
        containerPort: 8000,
        logDriver: new AwsLogDriver({
          logGroup,
          streamPrefix: 'backend',
        }),
        environment: {
          LANCEDB_STORAGE_BUCKET_NAME: lancedbStorage.bucketName,
          LANCEDB_LOCK_TABLE_NAME: lancedbLockTable.tableName,
          DOCUMENT_STORAGE_BUCKET_NAME: documentStorage.bucketName,
          BACKEND_TABLE_NAME: backendTable.tableName,
          LANCEDB_EXPRESS_BUCKET_NAME: lancedbExpressBucketName,
          WEBSOCKET_ENDPOINT: websocketEndpoint,
          SESSION_STORAGE_BUCKET_NAME: sessionStorage.bucketName,
        },
      },
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
      memoryLimitMiB: 8192,
      cpu: 2048,
      desiredCount: 1,
      publicLoadBalancer: false,
    });

    const taskRole = this.service.taskDefinition.taskRole;
    lancedbStorage.bucket.grantReadWrite(taskRole);
    documentStorage.bucket.grantReadWrite(taskRole);
    sessionStorage.bucket.grantRead(taskRole);
    lancedbLockTable.table.grantReadWriteData(taskRole);
    backendTable.table.grantReadWriteData(taskRole);

    // Grant GSI1 query permissions (fromTableName doesn't include GSI permissions)
    taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${backendTable.table.tableArn}/index/GSI1`],
      }),
    );

    taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['s3express:*'],
        resources: ['*'],
      }),
    );

    // Grant Bedrock model invoke permissions
    taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Rerank',
        ],
        resources: ['*'],
      }),
    );

    // Security Group for VPC Link
    const vpcLinkSg = new SecurityGroup(this, 'VpcLinkSg', {
      vpc,
      description: 'Security group for VPC Link',
      allowAllOutbound: true,
    });

    // VPC Link for API Gateway - use private subnets
    const vpcLink = new VpcLink(this, 'VpcLink', {
      vpc,
      subnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [vpcLinkSg],
    });

    // Allow VPC Link to access ALB
    this.service.loadBalancer.connections.allowFrom(
      vpcLinkSg,
      Port.tcp(80),
      'Allow from VPC Link',
    );

    // HTTP API with IAM auth
    const authorizer = new HttpIamAuthorizer();

    this.api = new HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: [
          'authorization',
          'content-type',
          'x-amz-content-sha256',
          'x-amz-date',
          'x-amz-security-token',
        ],
      },
    });

    const integration = new HttpAlbIntegration(
      'AlbIntegration',
      this.service.listener,
      { vpcLink },
    );

    this.api.addRoutes({
      path: '/{proxy+}',
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
        HttpMethod.DELETE,
        HttpMethod.PATCH,
      ],
      integration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.OPTIONS],
      integration,
    });

    new CfnOutput(this, 'BackendUrl', {
      value: this.api.url ?? '',
    });

    RuntimeConfig.ensure(this).config.apis = {
      ...RuntimeConfig.ensure(this).config.apis,
      Backend: this.api.url,
    };
  }

  grantInvokeAccess(grantee: IGrantable) {
    Grant.addToPrincipal({
      grantee,
      actions: ['execute-api:Invoke'],
      resourceArns: [this.api.arnForExecuteApi('*', '/*', '*')],
    });
  }

  restrictCorsTo(...websites: { cloudFrontDistribution: Distribution }[]) {
    const allowedOrigins = websites.map(
      ({ cloudFrontDistribution }) =>
        `https://${cloudFrontDistribution.distributionDomainName}`,
    );

    const cfnApi = this.api.node.defaultChild;
    if (!(cfnApi instanceof CfnApi)) {
      throw new Error(
        'Unable to configure CORS: API default child is not a CfnApi instance',
      );
    }

    cfnApi.corsConfiguration = {
      allowOrigins: [
        'http://localhost:4200',
        'http://localhost:4300',
        ...allowedOrigins,
      ],
      allowMethods: [CorsHttpMethod.ANY],
      allowHeaders: [
        'authorization',
        'content-type',
        'x-amz-content-sha256',
        'x-amz-date',
        'x-amz-security-token',
      ],
      allowCredentials: true,
    };
  }
}
