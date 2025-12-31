import { Construct } from 'constructs';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { DockerImageFunction, DockerImageCode } from 'aws-cdk-lib/aws-lambda';
import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import {
  CorsHttpMethod,
  CfnApi,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { RuntimeConfig } from '../../core/runtime-config.js';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { SSM_KEYS } from '../../constants/ssm-keys.js';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Table, ITable } from 'aws-cdk-lib/aws-dynamodb';

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

export class Backend extends Construct {
  public readonly api: HttpApi;
  public readonly handler: DockerImageFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const logGroup = new LogGroup(this, 'BackendLogGroup', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY, // 원하는 설정 추가 가능
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

    this.handler = new DockerImageFunction(this, 'Function', {
      code: DockerImageCode.fromImageAsset('../backend', {
        platform: Platform.LINUX_ARM64,
      }),
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      tracing: Tracing.ACTIVE,
      logGroup,
      memorySize: 4096,
      environment: {
        LANCEDB_STORAGE_BUCKET_NAME: lancedbStorage.bucketName,
        LANCEDB_LOCK_TABLE_NAME: lancedbLockTable.tableName,
        DOCUMENT_STORAGE_BUCKET_NAME: documentStorage.bucketName,
        BACKEND_TABLE_NAME: backendTable.tableName,
      },
    });

    lancedbStorage.bucket.grantReadWrite(this.handler);
    documentStorage.bucket.grantReadWrite(this.handler);
    lancedbLockTable.table.grantReadWriteData(this.handler);
    backendTable.table.grantReadWriteData(this.handler);

    const integration = new HttpLambdaIntegration('Integration', this.handler);
    const authorizer = new HttpIamAuthorizer();

    // Create HTTP API
    this.api = new HttpApi(this, 'IDP-V2-Api', {
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

    // Public routes (no auth)
    this.api.addRoutes({
      path: '/docs',
      methods: [HttpMethod.GET],
      integration,
    });

    this.api.addRoutes({
      path: '/openapi',
      methods: [HttpMethod.GET],
      integration,
    });

    // Protected routes (IAM auth)
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

    // Register the API URL in runtime configuration
    RuntimeConfig.ensure(this).config.apis = {
      ...RuntimeConfig.ensure(this).config.apis,
      Backend: this.api.url,
    };
  }

  /**
   * Restricts CORS to the website CloudFront distribution domains
   */
  public restrictCorsTo(
    ...websites: { cloudFrontDistribution: Distribution }[]
  ) {
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

  /**
   * Grants IAM permissions to invoke any method on this API.
   */
  public grantInvokeAccess(grantee: IGrantable) {
    Grant.addToPrincipal({
      grantee,
      actions: ['execute-api:Invoke'],
      resourceArns: [this.api.arnForExecuteApi('*', '/*', '*')],
    });
  }
}
