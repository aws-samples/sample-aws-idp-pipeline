use lindera::dictionary::DictionaryKind;
use lindera::dictionary::load_embedded_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera::token_filter::BoxTokenFilter;
use lindera::token_filter::japanese_stop_tags::JapaneseStopTagsTokenFilter;
use lindera::token_filter::korean_stop_tags::KoreanStopTagsTokenFilter;
use lindera::token_filter::stop_words::StopWordsTokenFilter;
use lindera::tokenizer::Tokenizer;

fn korean_stop_tags_filter() -> BoxTokenFilter {
    let tags = [
        "EP", "EF", "EC", "ETN", "ETM", "IC", "JKS", "JKC", "JKG", "JKO", "JKB", "JKV", "JKQ",
        "JX", "JC", "MAG", "MAJ", "MM", "SP", "SSC", "SSO", "SC", "SE", "XPN", "XSA", "XSN",
        "XSV", "UNA", "NA", "VSV",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    BoxTokenFilter::from(KoreanStopTagsTokenFilter::new(tags))
}

fn japanese_stop_tags_filter() -> BoxTokenFilter {
    let tags = [
        "接続詞",
        "助詞",
        "助詞,格助詞",
        "助詞,格助詞,一般",
        "助詞,格助詞,引用",
        "助詞,格助詞,連語",
        "助詞,係助詞",
        "助詞,副助詞",
        "助詞,間投助詞",
        "助詞,並立助詞",
        "助詞,終助詞",
        "助詞,副助詞／並立助詞／終助詞",
        "助詞,連体化",
        "助詞,副詞化",
        "助詞,特殊",
        "助動詞",
        "記号",
        "記号,一般",
        "記号,読点",
        "記号,句点",
        "記号,空白",
        "記号,括弧閉",
        "その他,間投",
        "フィラー",
        "非言語音",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    BoxTokenFilter::from(JapaneseStopTagsTokenFilter::new(tags))
}

fn chinese_stop_words_filter() -> BoxTokenFilter {
    let words = [
        "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上",
        "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这",
        "他", "她", "它", "们", "那", "些", "什么", "怎么", "如果", "因为", "所以", "但是",
        "而且", "或者", "以及", "对于", "关于", "通过", "可以", "已经", "这个", "那个", "哪",
        "吗", "呢", "吧", "啊", "呀", "把", "被", "让", "给", "从", "向", "与", "及",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    BoxTokenFilter::from(StopWordsTokenFilter::new(words))
}

pub fn tokenize(text: &str, lang: &str) -> Vec<String> {
    let (kind, filter) = match lang {
        "ko" => (DictionaryKind::KoDic, korean_stop_tags_filter()),
        "ja" => (DictionaryKind::IPADIC, japanese_stop_tags_filter()),
        "zh" => (DictionaryKind::Jieba, chinese_stop_words_filter()),
        _ => return text.split_whitespace().map(String::from).collect(),
    };

    let dictionary = load_embedded_dictionary(kind).unwrap();
    let segmenter = Segmenter::new(Mode::Normal, dictionary, None);
    let mut tokenizer = Tokenizer::new(segmenter);
    tokenizer.append_token_filter(filter);
    let tokens = tokenizer.tokenize(text).unwrap();

    tokens
        .into_iter()
        .map(|t| t.surface.as_ref().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_korean_tokenize() {
        let tokens = tokenize("나는 학교에 갑니다", "ko");
        assert!(!tokens.is_empty());
        assert!(tokens.contains(&"나".to_string()) || tokens.contains(&"학교".to_string()));
    }

    #[test]
    fn test_japanese_tokenize() {
        let tokens = tokenize("東京は日本の首都です", "ja");
        assert!(!tokens.is_empty());
        assert!(tokens.contains(&"東京".to_string()));
    }

    #[test]
    fn test_chinese_tokenize() {
        let tokens = tokenize("我喜欢学习中文", "zh");
        assert!(!tokens.is_empty());
        assert!(tokens.contains(&"中文".to_string()));
    }

    #[test]
    fn test_unsupported_lang_falls_back_to_whitespace() {
        let tokens = tokenize("hello world test", "en");
        assert_eq!(tokens, vec!["hello", "world", "test"]);
    }
}
