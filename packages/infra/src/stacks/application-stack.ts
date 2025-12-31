import { Backend, Frontend, UserIdentity } from ':idp-v2/common-constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const userIdentity = new UserIdentity(this, 'UserIdentity');

    const backend = new Backend(this, 'Backend');

    const frontend = new Frontend(this, 'Frontend');

    backend.restrictCorsTo(frontend);
    backend.grantInvokeAccess(userIdentity.identityPool.authenticatedRole);
  }
}
