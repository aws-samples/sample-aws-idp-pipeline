use aws_sdk_s3::Client;
use lambda_runtime::{Error, LambdaEvent, service_fn, tracing};
use paddle_ocr::engine::{Language, OrientationOptions, create_engine};
use paddle_ocr::process;
use paddle_ocr::s3::{download_from_s3, parse_s3_uri};
use serde::Deserialize;

#[derive(Deserialize)]
struct Request {
    s3_uri: String,
    lang: Language,
    #[serde(default)]
    use_doc_orientation_classify: bool,
    from: Option<usize>,
    to: Option<usize>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();

    let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let s3_client = Client::new(&config);

    lambda_runtime::run(service_fn(|event: LambdaEvent<Request>| {
        let s3_client = &s3_client;
        async move {
            let orientation = OrientationOptions {
                use_doc_orientation_classify: event.payload.use_doc_orientation_classify,
            };
            let engine = create_engine(event.payload.lang, orientation)?;
            let s3_uri = &event.payload.s3_uri;
            let (_, key) = parse_s3_uri(s3_uri)?;
            let bytes = download_from_s3(s3_client, s3_uri).await?;
            let response = process(&engine, &bytes, key, event.payload.from, event.payload.to)?;

            Ok::<_, Error>(response)
        }
    }))
    .await
}
