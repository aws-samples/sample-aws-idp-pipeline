import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { RustFunction } from 'cargo-lambda-cdk';
import { Construct } from 'constructs';
import { SSM_KEYS } from ':idp-v2/common-constructs';

export class LanceServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const tokaFunction = new RustFunction(this, 'TokaFunction', {
      functionName: 'idp-v2-toka',
      manifestPath: '../lambda/toka',
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
    });

    new StringParameter(this, 'TokaFunctionNameParam', {
      parameterName: SSM_KEYS.TOKA_FUNCTION_NAME,
      stringValue: tokaFunction.functionName,
    });

    // LanceDB resources (from SSM)
    const lancedbExpressBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
    );
    const lancedbLockTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
    );
    const lancedbLockTable = dynamodb.Table.fromTableName(
      this,
      'LanceDBLockTable',
      lancedbLockTableName,
    );

    const lanceDbServiceFunction = new RustFunction(
      this,
      'LanceDbServiceFunction',
      {
        functionName: 'idp-v2-lance-service',
        manifestPath: '../lambda/lancedb-service',
        architecture: lambda.Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(5),
        environment: {
          TOKA_FUNCTION_NAME: tokaFunction.functionName,
          LANCEDB_EXPRESS_BUCKET_NAME: lancedbExpressBucketName,
          LANCEDB_LOCK_TABLE_NAME: lancedbLockTableName,
        },
      },
    );

    // Toka Lambda invoke
    tokaFunction.grantInvoke(lanceDbServiceFunction);

    // S3 Express One Zone (LanceDB storage)
    lanceDbServiceFunction.addToRolePolicy(
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

    // DynamoDB LanceDB Lock table
    lancedbLockTable.grantReadWriteData(lanceDbServiceFunction);

    // Bedrock (embeddings)
    lanceDbServiceFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }),
    );

    new StringParameter(this, 'LanceDbServiceFunctionArnParam', {
      parameterName: SSM_KEYS.LANCE_SERVICE_FUNCTION_ARN,
      stringValue: lanceDbServiceFunction.functionArn,
    });


  }
}
