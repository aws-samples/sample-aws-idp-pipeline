import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SearchMcp } from ':idp-v2/common-constructs';

export class McpStack extends Stack {
  public readonly searchMcp: SearchMcp;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.searchMcp = new SearchMcp(this, 'SearchMcp');
  }
}
