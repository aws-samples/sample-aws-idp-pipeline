use aws_sdk_s3::Client;

pub fn parse_s3_uri(s3_uri: &str) -> anyhow::Result<(&str, &str)> {
    let path = s3_uri
        .strip_prefix("s3://")
        .ok_or_else(|| anyhow::anyhow!("invalid s3 uri: {}", s3_uri))?;
    let (bucket, key) = path
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("invalid s3 uri: {}", s3_uri))?;
    Ok((bucket, key))
}

pub async fn download_from_s3(client: &Client, s3_uri: &str) -> anyhow::Result<Vec<u8>> {
    let (bucket, key) = parse_s3_uri(s3_uri)?;
    let resp = client.get_object().bucket(bucket).key(key).send().await?;
    let bytes = resp.body.collect().await?.into_bytes();
    Ok(bytes.to_vec())
}
