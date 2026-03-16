import { Stack, StackProps } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { RustFunction } from 'cargo-lambda-cdk';
import { SSM_KEYS } from ':idp-v2/common-constructs';

export class LanceServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const tokaFunction = new RustFunction(this, 'TokaFunction', {
      functionName: 'idp-v2-toka',
      manifestPath: '../lambda/toka/Cargo.toml',
      memorySize: 1024,
    });

    new StringParameter(this, 'TokaFunctionNameParam', {
      parameterName: SSM_KEYS.TOKA_FUNCTION_NAME,
      stringValue: tokaFunction.functionName,
    });
  }
}
