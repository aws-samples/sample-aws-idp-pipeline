import { Frontend, UserIdentity } from ':idp-v2/common-constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new UserIdentity(this, 'UserIdentity');

    new Frontend(this, 'Frontend');
  }
}
