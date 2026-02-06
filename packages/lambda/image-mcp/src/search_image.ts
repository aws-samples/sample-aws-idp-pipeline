import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const s3Client = new S3Client();
const ssmClient = new SSMClient();

export interface SearchImageInput {
  prompt: string;
  orientation?: 'landscape' | 'portrait' | 'squarish';
  s3_key?: string;
}

export interface SearchImageOutput {
  url: string;
  s3_uri?: string;
  author: string;
}

interface UnsplashPhoto {
  id: string;
  urls: {
    regular: string;
  };
  user: {
    name: string;
  };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

let cachedAccessKey: string | null = null;

async function getUnsplashAccessKey(): Promise<string> {
  if (cachedAccessKey) {
    return cachedAccessKey;
  }

  const command = new GetParameterCommand({
    Name: process.env.UNSPLASH_ACCESS_KEY_PARAM,
    WithDecryption: true,
  });
  const response = await ssmClient.send(command);
  cachedAccessKey = response.Parameter?.Value ?? '';
  return cachedAccessKey;
}

async function searchUnsplash(
  accessKey: string,
  query: string,
  orientation?: string,
): Promise<UnsplashPhoto | null> {
  const params = new URLSearchParams({
    query,
    per_page: '1',
  });

  if (orientation) {
    params.append('orientation', orientation);
  }

  const url = `https://api.unsplash.com/search/photos?${params}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Unsplash API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as UnsplashSearchResponse;
  return data.results[0] ?? null;
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadToS3(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export const handler = async (event: SearchImageInput): Promise<SearchImageOutput> => {
  const { prompt, orientation, s3_key } = event;

  const accessKey = await getUnsplashAccessKey();
  const photo = await searchUnsplash(accessKey, prompt, orientation);

  if (!photo) {
    throw new Error(`No images found for query: ${prompt}`);
  }

  const imageUrl = photo.urls.regular;

  if (!s3_key) {
    return {
      url: imageUrl,
      author: photo.user.name,
    };
  }

  const imageBuffer = await downloadImage(imageUrl);
  const bucket = process.env.AGENT_STORAGE_BUCKET;

  await uploadToS3(bucket, s3_key, imageBuffer, 'image/jpeg');

  return {
    url: imageUrl,
    s3_uri: `s3://${bucket}/${s3_key}`,
    author: photo.user.name,
  };
};
