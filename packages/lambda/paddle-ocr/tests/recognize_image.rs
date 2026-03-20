use paddle_ocr::engine::{create_engine, recognize_image};

#[test]
fn test_recognize_image() {
    let engine = create_engine().expect("failed to create OCR engine");
    let image = image::open("tests/fixtures/sample.jpg").expect("failed to open test image");

    let results = recognize_image(&engine, &image);

    println!("{:?}", results);

    assert!(
        !results.is_empty(),
        "should detect at least one text region"
    );

    for item in &results {
        assert!(!item.text.is_empty(), "text should not be empty");
        assert!(item.confidence > 0.0, "confidence should be positive");
    }
}
