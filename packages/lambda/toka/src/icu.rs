use icu_segmenter::{WordSegmenter, options::WordBreakInvariantOptions};

pub fn tokenize(text: &str) -> Vec<String> {
    let segmenter = WordSegmenter::new_auto(WordBreakInvariantOptions::default());
    let breakpoints: Vec<usize> = segmenter.segment_str(text).collect();

    breakpoints
        .windows(2)
        .filter_map(|w| {
            let segment = &text[w[0]..w[1]];
            let has_word_char = segment.chars().any(|c| c.is_alphanumeric());
            if has_word_char {
                Some(segment.to_string())
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_english_tokenize() {
        let tokens = tokenize("hello world test");
        assert_eq!(tokens, vec!["hello", "world", "test"]);
    }

    #[test]
    fn test_vietnamese_tokenize() {
        let tokens = tokenize("Xin chào thế giới");
        assert!(!tokens.is_empty());
        assert!(tokens.contains(&"Xin".to_string()));
    }
}
