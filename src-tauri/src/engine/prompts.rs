//! Transcription style prompts, relaxed post-processing, and the transform
//! prompt with its voice presets. Ported verbatim from the old server
//! (`server/src/services/transcription.ts` and `transform.ts`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionStyle {
    Formal,
    #[default]
    Balanced,
    Relaxed,
}

impl TranscriptionStyle {
    /// Prompt that nudges Whisper towards the style's punctuation and casing.
    pub fn prompt(self) -> &'static str {
        match self {
            Self::Formal => "Meeting notes: The quarterly report indicates a 15% increase in revenue. We should schedule a follow-up discussion with the executive team. Please ensure all documentation is properly formatted.",
            Self::Balanced => "So I was thinking we could try the new approach. Let me know what you think about it. The results look promising so far.",
            Self::Relaxed => "yeah so basically i was just wondering if we could maybe try something different you know",
        }
    }

    pub fn post_process(self, text: &str) -> String {
        match self {
            Self::Relaxed => relax(text),
            _ => text.trim().to_string(),
        }
    }
}

/// Relaxed style: lowercase, strip `.,!?;:'"()-`, collapse whitespace, trim.
pub fn relax(text: &str) -> String {
    let stripped: String = text
        .to_lowercase()
        .chars()
        .filter(|c| !matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | '\'' | '"' | '(' | ')' | '-'))
        .collect();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub const TRANSFORM_SYSTEM_PROMPT: &str = "You are a text transformation assistant. Transform the user's text according to their instructions. Only output the transformed text, nothing else. Do not add explanations or commentary.";

pub const TRANSFORM_MAX_CHARS: usize = 10_000;

pub fn transform_user_message(instruction: &str, text: &str) -> String {
    format!("Instruction: {instruction}\n\nText to transform:\n{text}")
}

/// `min(max(1000, ceil(len / 4) * 2), 16000)`
pub fn transform_max_tokens(text: &str) -> u32 {
    let len = text.chars().count() as u32;
    (len.div_ceil(4) * 2).clamp(1000, 16_000)
}

/// The user's custom transform prompt goes first, as standing instructions.
pub fn combine_instruction(custom_prompt: Option<&str>, instruction: &str) -> String {
    match custom_prompt.map(str::trim).filter(|p| !p.is_empty()) {
        Some(custom) => format!("{custom}\n\nUser's instruction: {instruction}"),
        None => instruction.to_string(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Grammar,
    Formal,
    Casual,
    Concise,
    Expand,
    Bullets,
    Email,
    CodeComment,
    Summarize,
    TranslateSpanish,
    TranslateFrench,
    TranslateGerman,
}

impl Preset {
    pub const ALL: [Preset; 12] = [
        Preset::Grammar,
        Preset::Formal,
        Preset::Casual,
        Preset::Concise,
        Preset::Expand,
        Preset::Bullets,
        Preset::Email,
        Preset::CodeComment,
        Preset::Summarize,
        Preset::TranslateSpanish,
        Preset::TranslateFrench,
        Preset::TranslateGerman,
    ];

    pub fn instruction(self) -> &'static str {
        match self {
            Self::Grammar => "Fix grammar and spelling errors while preserving the original meaning and tone.",
            Self::Formal => "Rewrite this text in a more formal, professional tone.",
            Self::Casual => "Rewrite this text in a more casual, conversational tone.",
            Self::Concise => "Make this text more concise while keeping the key information.",
            Self::Expand => "Expand this text with more detail and explanation.",
            Self::Bullets => "Convert this text into clear bullet points.",
            Self::Email => "Reformat this as a professional email.",
            Self::CodeComment => "Rewrite this as a clear code comment or documentation.",
            Self::Summarize => "Summarize the key points of this text.",
            Self::TranslateSpanish => "Translate this text to Spanish.",
            Self::TranslateFrench => "Translate this text to French.",
            Self::TranslateGerman => "Translate this text to German.",
        }
    }

    /// Spoken phrases that select this preset. They are compared after
    /// `normalize_command`, so write them lowercase without punctuation.
    /// Keep this list conservative: anything that isn't an exact match is sent
    /// to the model as the user's own instruction, which also works.
    fn triggers(self) -> &'static [&'static str] {
        match self {
            Self::Grammar => &[
                "fix grammar", "fix the grammar", "fix my grammar", "fix spelling", "fix the spelling",
                "fix grammar and spelling", "fix spelling and grammar", "fix the grammar and spelling",
                "fix typos", "fix the typos", "correct this", "correct the grammar", "grammar",
                "proofread", "proofread this", "check grammar", "check the grammar",
            ],
            Self::Formal => &[
                "formal", "more formal", "make it formal", "make this formal", "make it more formal",
                "make this more formal", "more professional", "make it professional",
                "make it more professional", "make this more professional", "make this professional",
                "sound more professional",
            ],
            Self::Casual => &[
                "casual", "more casual", "make it casual", "make this casual", "make it more casual",
                "make this more casual", "less formal", "make it less formal", "make this less formal",
                "more conversational", "make it conversational", "make it more conversational",
            ],
            Self::Concise => &[
                "concise", "more concise", "make it concise", "make this concise", "make it more concise",
                "make this more concise", "shorter", "make it shorter", "make this shorter",
                "shorten", "shorten this", "shorten it", "condense this", "tighten this up", "tighten it up",
            ],
            Self::Expand => &[
                "expand", "expand this", "expand on this", "expand it", "make it longer",
                "make this longer", "longer", "elaborate", "elaborate on this", "add more detail",
                "add more details",
            ],
            Self::Bullets => &[
                "bullets", "bullet points", "bullet point", "bullet list", "bulleted list",
                "make it bullets", "make it bullet points", "make this bullet points", "make a bullet list",
                "turn into bullets", "turn into bullet points", "turn this into bullets",
                "turn this into bullet points", "turn it into bullets", "turn it into bullet points",
                "convert to bullet points", "convert to bullets", "convert this to bullet points",
                "bullet point this", "make a list", "make it a list",
            ],
            Self::Email => &[
                "email", "make it an email", "make this an email", "turn this into an email",
                "turn it into an email", "turn into an email", "format as an email",
                "format this as an email", "write an email", "make it a professional email",
                "reformat as an email",
            ],
            Self::CodeComment => &[
                "code comment", "make it a code comment", "make this a code comment",
                "turn this into a code comment", "turn it into a code comment", "write a code comment",
                "make it a comment", "make it documentation", "document this", "make it a doc comment",
            ],
            Self::Summarize => &[
                "summarize", "summarise", "summarize this", "summarise this", "summarize it",
                "summary", "give me a summary", "make a summary", "tldr", "tl dr",
            ],
            Self::TranslateSpanish => &[
                "spanish", "in spanish", "to spanish", "translate to spanish", "translate into spanish",
                "translate this to spanish", "translate this into spanish", "translate it to spanish",
                "translate it into spanish", "make it spanish", "say it in spanish",
            ],
            Self::TranslateFrench => &[
                "french", "in french", "to french", "translate to french", "translate into french",
                "translate this to french", "translate this into french", "translate it to french",
                "translate it into french", "make it french", "say it in french",
            ],
            Self::TranslateGerman => &[
                "german", "in german", "to german", "translate to german", "translate into german",
                "translate this to german", "translate this into german", "translate it to german",
                "translate it into german", "make it german", "say it in german",
            ],
        }
    }
}

/// Politeness and filler that may wrap a command ("please make it shorter").
const LEADING_FILLERS: &[&str] = &[
    "please", "can you", "could you", "would you", "can you please", "could you please",
    "okay", "ok", "hey abe", "abe", "um", "uh", "so",
];
const TRAILING_FILLERS: &[&str] = &["please", "for me", "thanks", "thank you"];

/// Lowercase, turn hyphens and slashes into spaces, drop other punctuation,
/// collapse whitespace and peel filler words off both ends.
pub fn normalize_command(command: &str) -> String {
    let cleaned: String = command
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            '-' | '/' | '_' => Some(' '),
            c if c.is_alphanumeric() || c.is_whitespace() => Some(c),
            _ => None,
        })
        .collect();
    let mut words: Vec<&str> = cleaned.split_whitespace().collect();

    loop {
        let before = words.len();
        // Longest filler first so "can you please" wins over "can you"
        let mut leading: Vec<&&str> = LEADING_FILLERS.iter().collect();
        leading.sort_by_key(|f| std::cmp::Reverse(f.len()));
        for filler in leading {
            let n = filler.split(' ').count();
            if words.len() > n && words[..n].join(" ") == **filler {
                words.drain(..n);
                break;
            }
        }
        for filler in TRAILING_FILLERS {
            let n = filler.split(' ').count();
            if words.len() > n && words[words.len() - n..].join(" ") == *filler {
                words.truncate(words.len() - n);
                break;
            }
        }
        if words.len() == before {
            break;
        }
    }
    words.join(" ")
}

/// The preset whose trigger phrase the spoken command matches, if any.
pub fn match_preset(command: &str) -> Option<Preset> {
    let normalized = normalize_command(command);
    if normalized.is_empty() {
        return None;
    }
    Preset::ALL
        .into_iter()
        .find(|preset| preset.triggers().contains(&normalized.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relaxed_post_processing() {
        assert_eq!(relax("  Hello, World! It's (really) great -- yes?  "), "hello world its really great yes");
        assert_eq!(relax("Line one.\nLine\ttwo;"), "line one line two");
        assert_eq!(relax(""), "");
        assert_eq!(TranscriptionStyle::Balanced.post_process("  Keep Me.  "), "Keep Me.");
        assert_eq!(TranscriptionStyle::Relaxed.post_process("Keep Me."), "keep me");
    }

    #[test]
    fn style_prompts_are_exact() {
        assert!(TranscriptionStyle::Formal.prompt().starts_with("Meeting notes: The quarterly report"));
        assert_eq!(
            TranscriptionStyle::Relaxed.prompt(),
            "yeah so basically i was just wondering if we could maybe try something different you know"
        );
        let style: TranscriptionStyle = serde_json::from_str("\"relaxed\"").unwrap();
        assert_eq!(style, TranscriptionStyle::Relaxed);
    }

    #[test]
    fn max_tokens_formula() {
        assert_eq!(transform_max_tokens(""), 1000);
        assert_eq!(transform_max_tokens(&"a".repeat(1999)), 1000);
        assert_eq!(transform_max_tokens(&"a".repeat(4001)), 2002);
        assert_eq!(transform_max_tokens(&"a".repeat(10_000)), 5000);
        assert_eq!(transform_max_tokens(&"a".repeat(100_000)), 16_000);
    }

    #[test]
    fn user_message_format() {
        assert_eq!(
            transform_user_message("Be brief.", "Some text"),
            "Instruction: Be brief.\n\nText to transform:\nSome text"
        );
    }

    #[test]
    fn custom_prompt_is_prepended() {
        assert_eq!(combine_instruction(None, "do it"), "do it");
        assert_eq!(combine_instruction(Some("  "), "do it"), "do it");
        assert_eq!(
            combine_instruction(Some("Use British spelling."), "do it"),
            "Use British spelling.\n\nUser's instruction: do it"
        );
    }

    #[test]
    fn matches_presets_by_voice() {
        assert_eq!(match_preset("Fix the grammar."), Some(Preset::Grammar));
        assert_eq!(match_preset("fix spelling"), Some(Preset::Grammar));
        assert_eq!(match_preset("Please make it shorter."), Some(Preset::Concise));
        assert_eq!(match_preset("Can you please turn this into bullet points?"), Some(Preset::Bullets));
        assert_eq!(match_preset("Bullet-points"), Some(Preset::Bullets));
        assert_eq!(match_preset("TL;DR"), Some(Preset::Summarize));
        assert_eq!(match_preset("Translate to Spanish, please."), Some(Preset::TranslateSpanish));
        assert_eq!(match_preset("In French."), Some(Preset::TranslateFrench));
        assert_eq!(match_preset("translate it into german"), Some(Preset::TranslateGerman));
        assert_eq!(match_preset("Make it more formal"), Some(Preset::Formal));
        assert_eq!(match_preset("make this an email for me"), Some(Preset::Email));
    }

    #[test]
    fn leaves_other_commands_alone() {
        assert_eq!(match_preset(""), None);
        assert_eq!(match_preset("please"), None);
        assert_eq!(match_preset("Translate to Japanese"), None);
        assert_eq!(match_preset("make it shorter and add a joke"), None);
        assert_eq!(match_preset("fix the grammar but keep the swear words"), None);
        assert_eq!(match_preset("rewrite as a pirate"), None);
        assert_eq!(match_preset("email to bob saying hi"), None);
    }

    #[test]
    fn every_trigger_is_normalized_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for preset in Preset::ALL {
            for trigger in preset.triggers() {
                assert_eq!(normalize_command(trigger), *trigger, "{trigger} is not normalized");
                assert!(seen.insert(*trigger), "{trigger} is listed twice");
            }
        }
    }

    #[test]
    fn preset_keys_match_frontend() {
        assert_eq!(serde_json::to_string(&Preset::CodeComment).unwrap(), "\"code_comment\"");
        assert_eq!(serde_json::to_string(&Preset::TranslateSpanish).unwrap(), "\"translate_spanish\"");
    }
}
