import { App as _App, AppProps, Aspects, IAspect, Stack } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export class App extends _App {
  constructor(props?: AppProps) {
    super(props);

    Aspects.of(this).add(new MetricsAspect());
  }
}

/**
 * Adds information to CloudFormation stack descriptions to provide usage metrics for @aws/nx-plugin
 */
class MetricsAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof Stack) {
      const id = 'uksb-4wk0bqpg5s';
      const version = '0.64.1';
      const tags: string[] = ['g8', 'g5', 'g7', 'g6'];
      node.templateOptions.description = `${
        node.templateOptions.description ?? ''
      } (${id}) (version:${version}) (tag:${tags.join(',')})`.trim();
    }
  }
}
