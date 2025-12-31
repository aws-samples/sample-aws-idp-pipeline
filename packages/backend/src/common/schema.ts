import * as apacheArrow from 'apache-arrow';

const VECTOR_DIMENSION = 1024;

export const documentSchema = new apacheArrow.Schema([
  new apacheArrow.Field('document_id', new apacheArrow.Utf8()),
  new apacheArrow.Field('segment_id', new apacheArrow.Utf8()),
  new apacheArrow.Field('segment_index', new apacheArrow.Int32()),
  new apacheArrow.Field('status', new apacheArrow.Utf8()),
  new apacheArrow.Field('content', new apacheArrow.Utf8()),
  new apacheArrow.Field(
    'vector',
    new apacheArrow.FixedSizeList(
      VECTOR_DIMENSION,
      new apacheArrow.Field('item', new apacheArrow.Float32()),
    ),
  ),
  new apacheArrow.Field('keywords', new apacheArrow.Utf8()),
  new apacheArrow.Field('tools_json', new apacheArrow.Utf8()),
  new apacheArrow.Field('content_combined', new apacheArrow.Utf8()),
  new apacheArrow.Field('file_uri', new apacheArrow.Utf8()),
  new apacheArrow.Field('file_type', new apacheArrow.Utf8()),
  new apacheArrow.Field('image_uri', new apacheArrow.Utf8(), true),
  new apacheArrow.Field('created_at', new apacheArrow.TimestampMillisecond()),
  new apacheArrow.Field('updated_at', new apacheArrow.TimestampMillisecond()),
]);
