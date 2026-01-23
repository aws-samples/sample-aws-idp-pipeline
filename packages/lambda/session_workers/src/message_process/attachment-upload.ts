import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import { MessageKeyInfo } from '../parse-session-s3-key';

interface AttachmentSource {
  bytes: {
    data: string;
  };
}

interface ImageValue {
  format: string;
  source: AttachmentSource;
  s3_url?: string;
}

interface DocumentValue {
  format: string;
  name: string;
  source: AttachmentSource;
  s3_url?: string;
}

interface ToolResultItem {
  text?: string;
  image?: ImageValue;
  document?: DocumentValue;
}

interface MessageContent {
  text?: string;
  toolResult?: {
    toolUseId: string;
    status: string;
    content?: ToolResultItem[];
  };
  image?: ImageValue;
  document?: DocumentValue;
}

interface MessageData {
  message: {
    role: string;
    content: MessageContent[];
  };
  [key: string]: unknown;
}

function hasUnprocessedAttachments(messageData: MessageData): boolean {
  for (const content of messageData.message.content) {
    if (content.image && !content.image.s3_url) {
      return true;
    }
    if (content.document && !content.document.s3_url) {
      return true;
    }
    if (content.toolResult?.content) {
      for (const item of content.toolResult.content) {
        if (item.image && !item.image.s3_url) {
          return true;
        }
        if (item.document && !item.document.s3_url) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function handleAttachmentUpload(
  s3Client: S3Client,
  bucket: string,
  key: string,
  keyInfo: MessageKeyInfo,
): Promise<void> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await response.Body?.transformToString();
  if (!body) {
    return;
  }

  const messageData: MessageData = JSON.parse(body);

  if (!hasUnprocessedAttachments(messageData)) {
    return;
  }

  const artifactsPrefix = `sessions/${keyInfo.userId}/${keyInfo.projectId}/${keyInfo.sessionId}/agents/${keyInfo.agentId}/artifacts`;

  for (const content of messageData.message.content) {
    if (content.image) {
      content.image.s3_url = await uploadAttachment(
        s3Client,
        bucket,
        artifactsPrefix,
        content.image.format,
        content.image.source,
        `image/${content.image.format}`,
      );
    }

    if (content.document) {
      content.document.s3_url = await uploadAttachment(
        s3Client,
        bucket,
        artifactsPrefix,
        content.document.format,
        content.document.source,
        getDocumentContentType(content.document.format),
      );
    }

    if (content.toolResult?.content) {
      for (const item of content.toolResult.content) {
        if (item.image) {
          item.image.s3_url = await uploadAttachment(
            s3Client,
            bucket,
            artifactsPrefix,
            item.image.format,
            item.image.source,
            `image/${item.image.format}`,
          );
        }
        if (item.document) {
          item.document.s3_url = await uploadAttachment(
            s3Client,
            bucket,
            artifactsPrefix,
            item.document.format,
            item.document.source,
            getDocumentContentType(item.document.format),
          );
        }
      }
    }
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(messageData),
      ContentType: 'application/json',
    }),
  );

  console.log(`Updated message with artifact URLs: ${key}`);
}

async function uploadAttachment(
  s3Client: S3Client,
  bucket: string,
  artifactsPrefix: string,
  format: string,
  source: AttachmentSource,
  contentType: string,
): Promise<string> {
  const id = nanoid();
  const artifactKey = `${artifactsPrefix}/${id}.${format}`;
  const buffer = Buffer.from(source.bytes.data, 'base64');

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: artifactKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  console.log(`Uploaded artifact: ${artifactKey}`);
  return `s3://${bucket}/${artifactKey}`;
}

function getDocumentContentType(format: string): string {
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    html: 'text/html',
    txt: 'text/plain',
    md: 'text/markdown',
  };
  return contentTypes[format] ?? 'application/octet-stream';
}
