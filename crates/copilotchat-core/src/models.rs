use std::collections::HashSet;

use crate::types::{ListedModel, ModelAvailability};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogModel {
    pub id: &'static str,
    pub label: &'static str,
}

pub fn opencode_catalog() -> &'static [CatalogModel] {
    &[
        CatalogModel {
            id: "claude-haiku-4.5",
            label: "Claude Haiku 4.5",
        },
        CatalogModel {
            id: "claude-opus-4.5",
            label: "Claude Opus 4.5",
        },
        CatalogModel {
            id: "claude-opus-4.6",
            label: "Claude Opus 4.6",
        },
        CatalogModel {
            id: "claude-opus-41",
            label: "Claude Opus 4.1",
        },
        CatalogModel {
            id: "claude-sonnet-4",
            label: "Claude Sonnet 4",
        },
        CatalogModel {
            id: "claude-sonnet-4.5",
            label: "Claude Sonnet 4.5",
        },
        CatalogModel {
            id: "claude-sonnet-4.6",
            label: "Claude Sonnet 4.6",
        },
        CatalogModel {
            id: "gemini-2.5-pro",
            label: "Gemini 2.5 Pro",
        },
        CatalogModel {
            id: "gemini-3-flash-preview",
            label: "Gemini 3 Flash (Preview)",
        },
        CatalogModel {
            id: "gemini-3-pro-preview",
            label: "Gemini 3 Pro (Preview)",
        },
        CatalogModel {
            id: "gemini-3.1-pro-preview",
            label: "Gemini 3.1 Pro",
        },
        CatalogModel {
            id: "gpt-4.1",
            label: "GPT-4.1",
        },
        CatalogModel {
            id: "gpt-4o",
            label: "GPT-4o",
        },
        CatalogModel {
            id: "gpt-5",
            label: "GPT-5",
        },
        CatalogModel {
            id: "gpt-5-mini",
            label: "GPT-5 mini",
        },
        CatalogModel {
            id: "gpt-5.1",
            label: "GPT-5.1",
        },
        CatalogModel {
            id: "gpt-5.1-codex",
            label: "GPT-5.1-Codex",
        },
        CatalogModel {
            id: "gpt-5.1-codex-max",
            label: "GPT-5.1-Codex-Max",
        },
        CatalogModel {
            id: "gpt-5.1-codex-mini",
            label: "GPT-5.1-Codex-Mini",
        },
        CatalogModel {
            id: "gpt-5.2",
            label: "GPT-5.2",
        },
        CatalogModel {
            id: "gpt-5.2-codex",
            label: "GPT-5.2-Codex",
        },
        CatalogModel {
            id: "gpt-5.3-codex",
            label: "GPT-5.3-Codex",
        },
        CatalogModel {
            id: "gpt-5.4",
            label: "GPT-5.4",
        },
        CatalogModel {
            id: "gpt-5.4-mini",
            label: "GPT-5.4 mini",
        },
        CatalogModel {
            id: "grok-code-fast-1",
            label: "Grok Code Fast 1",
        },
    ]
}

pub fn merge_models(live_models: &[LiveModel]) -> Vec<ListedModel> {
    let live_chat_models = live_models
        .iter()
        .filter(|model| model.model_type.as_deref() == Some("chat"))
        .collect::<Vec<_>>();
    let mut merged = opencode_catalog()
        .iter()
        .map(|catalog_model| {
            let matching = live_chat_models
                .iter()
                .copied()
                .filter(|model| {
                    model.id == catalog_model.id || normalize_family(model) == catalog_model.id
                })
                .collect::<Vec<_>>();
            let selected = pick_catalog_match(&matching);

            ListedModel {
                availability: availability_for(catalog_model.id, selected),
                id: catalog_model.id.to_string(),
                label: selected.map_or_else(
                    || catalog_model.label.to_string(),
                    |model| model.label.clone(),
                ),
            }
        })
        .collect::<Vec<_>>();

    let known_catalog_ids = opencode_catalog()
        .iter()
        .map(|model| model.id)
        .collect::<HashSet<_>>();
    let mut extra_live_families = live_chat_models
        .iter()
        .copied()
        .filter(|model| {
            model.model_picker_enabled
                && !known_catalog_ids.contains(model.id.as_str())
                && !known_catalog_ids.contains(normalize_family(model))
        })
        .map(normalize_family)
        .collect::<Vec<_>>();
    extra_live_families.sort_unstable();
    extra_live_families.dedup();

    for family in extra_live_families {
        let matching = live_chat_models
            .iter()
            .copied()
            .filter(|model| normalize_family(model) == family)
            .collect::<Vec<_>>();
        if let Some(selected) = pick_catalog_match(&matching) {
            merged.push(ListedModel {
                availability: availability_for(family, Some(selected)),
                id: family.to_string(),
                label: selected.label.clone(),
            });
        }
    }

    merged
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveModel {
    pub family: Option<String>,
    pub id: String,
    pub label: String,
    pub model_picker_enabled: bool,
    pub policy_state: Option<String>,
    pub preview: bool,
    pub supported_endpoints: Vec<String>,
    pub model_type: Option<String>,
}

const KNOWN_RETIRED_MODELS: [&str; 2] = ["claude-opus-41", "gpt-5"];

fn availability_for(model_id: &str, live_model: Option<&LiveModel>) -> ModelAvailability {
    if KNOWN_RETIRED_MODELS.contains(&model_id) {
        return ModelAvailability::Unsupported;
    }

    if live_model.is_some_and(|model| model.policy_state.as_deref() == Some("disabled")) {
        return ModelAvailability::Unsupported;
    }

    ModelAvailability::Available
}

fn normalize_family(model: &LiveModel) -> &str {
    model.family.as_deref().unwrap_or(&model.id)
}

fn pick_catalog_match<'a>(models: &'a [&'a LiveModel]) -> Option<&'a LiveModel> {
    models
        .iter()
        .copied()
        .max_by_key(|model| score_model(model))
}

fn score_model(model: &LiveModel) -> u8 {
    let mut score = 0;
    if model.id == normalize_family(model) {
        score += 4;
    }
    if model.model_picker_enabled {
        score += 2;
    }
    if !looks_versioned(&model.id) {
        score += 1;
    }
    if !model.preview {
        score += 1;
    }
    score
}

fn looks_versioned(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 11
        && bytes[bytes.len() - 11] == b'-'
        && bytes[bytes.len() - 8] == b'-'
        && bytes[bytes.len() - 10..bytes.len() - 6]
            .iter()
            .all(u8::is_ascii_digit)
        && bytes[bytes.len() - 5..].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use crate::types::ModelAvailability;

    use super::{LiveModel, merge_models};

    #[test]
    fn keeps_live_models_and_catalog_models_available_when_not_retired() {
        let merged = merge_models(&[
            LiveModel {
                family: Some("gpt-5.2-codex".into()),
                id: "gpt-5.2-codex".into(),
                label: "GPT-5.2-Codex".into(),
                model_picker_enabled: true,
                policy_state: Some("enabled".into()),
                preview: false,
                supported_endpoints: vec!["/chat/completions".into()],
                model_type: Some("chat".into()),
            },
            LiveModel {
                family: Some("gpt-4o".into()),
                id: "gpt-4o-2024-11-20".into(),
                label: "GPT-4o".into(),
                model_picker_enabled: true,
                policy_state: Some("enabled".into()),
                preview: false,
                supported_endpoints: vec!["/chat/completions".into()],
                model_type: Some("chat".into()),
            },
        ]);

        assert!(merged.iter().any(|model| {
            model.id == "gpt-5.2-codex"
                && model.label == "GPT-5.2-Codex"
                && model.availability == ModelAvailability::Available
        }));
        assert!(merged.iter().any(|model| {
            model.id == "gpt-4o"
                && model.label == "GPT-4o"
                && model.availability == ModelAvailability::Available
        }));
        assert!(merged.iter().any(|model| {
            model.id == "gpt-5.4"
                && model.label == "GPT-5.4"
                && model.availability == ModelAvailability::Available
        }));
        assert!(merged.iter().any(|model| {
            model.id == "gpt-5.4-mini"
                && model.label == "GPT-5.4 mini"
                && model.availability == ModelAvailability::Available
        }));
        assert!(merged.iter().any(|model| {
            model.id == "gpt-5"
                && model.label == "GPT-5"
                && model.availability == ModelAvailability::Unsupported
        }));
        assert!(merged.iter().any(|model| {
            model.id == "claude-opus-41"
                && model.label == "Claude Opus 4.1"
                && model.availability == ModelAvailability::Unsupported
        }));
    }

    #[test]
    fn includes_picker_enabled_live_models_missing_from_catalog() {
        let merged = merge_models(&[
            LiveModel {
                family: Some("gpt-5-nano".into()),
                id: "gpt-5-nano-2026-03-17".into(),
                label: "GPT-5 nano".into(),
                model_picker_enabled: true,
                policy_state: Some("enabled".into()),
                preview: false,
                supported_endpoints: vec!["/responses".into()],
                model_type: Some("chat".into()),
            },
            LiveModel {
                family: Some("gpt-5-nano".into()),
                id: "gpt-5-nano".into(),
                label: "GPT-5 nano".into(),
                model_picker_enabled: true,
                policy_state: Some("enabled".into()),
                preview: false,
                supported_endpoints: vec!["/responses".into()],
                model_type: Some("chat".into()),
            },
        ]);

        assert!(merged.iter().any(|model| {
            model.id == "gpt-5-nano"
                && model.label == "GPT-5 nano"
                && model.availability == ModelAvailability::Available
        }));
    }
}
