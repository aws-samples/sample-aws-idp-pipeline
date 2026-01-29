import { Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { SSM_KEYS } from '../../constants/ssm-keys.js';

export class SearchMcp extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/search-mcp/src/index.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        BACKEND_URL_SSM_KEY: SSM_KEYS.BACKEND_URL,
      },
    });

    const stack = Stack.of(this);
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter/idp-v2/*`,
        ],
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
