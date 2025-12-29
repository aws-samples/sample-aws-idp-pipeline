import * as url from 'url';
import { Construct } from 'constructs';
import { StaticWebsite } from '../../core/index.js';

export class Frontend extends StaticWebsite {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      websiteName: 'Frontend',
      websiteFilePath: url.fileURLToPath(
        new URL(
          '../../../../../../dist/packages/frontend/bundle',
          import.meta.url,
        ),
      ),
    });
  }
}
