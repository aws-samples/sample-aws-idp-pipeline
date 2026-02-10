import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { SSM_KEYS } from '../../constants/ssm-keys.js';

export class SearchMcp extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const documentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const documentStorageBucket = Bucket.fromBucketName(
      this,
      'DocumentStorageBucket',
      documentStorageBucketName,
    );

    const lancedbFunctionArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_FUNCTION_ARN,
    );

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/search-mcp/src/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        LANCEDB_FUNCTION_ARN: lancedbFunctionArn,
        DOCUMENT_STORAGE_BUCKET: documentStorageBucketName,
      },
    });

    documentStorageBucket.grantRead(this.function);

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [lancedbFunctionArn],
      }),
    );

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    new StringParameter(this, 'FunctionArnParam', {
      parameterName: SSM_KEYS.SEARCH_MCP_FUNCTION_ARN,
      stringValue: this.function.functionArn,
      description: 'ARN of the Search MCP Lambda function',
    });

    if (this.function.role) {
      new StringParameter(this, 'RoleArnParam', {
        parameterName: SSM_KEYS.SEARCH_MCP_ROLE_ARN,
        stringValue: this.function.role.roleArn,
        description: 'ARN of the Search MCP Lambda role',
      });
    }
  }
}
