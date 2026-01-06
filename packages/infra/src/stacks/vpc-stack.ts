import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { SSM_KEYS } from ':idp-v2/common-constructs';
import {
  Vpc,
  SubnetType,
  IpAddresses,
  FlowLogDestination,
  FlowLogTrafficType,
} from 'aws-cdk-lib/aws-ec2';

export class VpcStack extends Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    this.vpc.addFlowLog('FlowLog', {
      destination: FlowLogDestination.toCloudWatchLogs(),
      trafficType: FlowLogTrafficType.REJECT,
    });

    new StringParameter(this, 'VpcIdParam', {
      parameterName: SSM_KEYS.VPC_ID,
      stringValue: this.vpc.vpcId,
    });
  }
}
