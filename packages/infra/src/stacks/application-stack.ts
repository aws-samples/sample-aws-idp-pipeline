import {
  Backend,
  Frontend,
  UserIdentity,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpcId = StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });

    const userIdentity = new UserIdentity(this, 'UserIdentity');

    const backend = new Backend(this, 'Backend', { vpc });

    const frontend = new Frontend(this, 'Frontend');

    backend.restrictCorsTo(frontend);
    backend.grantInvokeAccess(userIdentity.identityPool.authenticatedRole);
  }
}
