import os
import sys

sys.path.insert(0, os.getcwd())

from src.engine.extraction import evidence_relevance as er

cond = (
    "The breakout gives an idea of the direction the market wants to go: a downside "
    "break is taken short, an upside break is taken long."
)
quote = "That gives us an idea of the direction in which the market wants to go for the day."

import importlib
spec = importlib.util.spec_from_file_location(
    "_svkm_driver", os.path.join("scripts", "svkm_opus_batch_locator.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
transcript, _ = mod.bench._load_pinned()

v_with_doc = er.evaluate_evidence_relevance(cond, quote, rival_conditions=(), source_document=transcript)
print("with real transcript as source_document:", v_with_doc.own_score)

v_no_doc = er.evaluate_evidence_relevance(cond, quote, rival_conditions=())
print("with NO source_document:", v_no_doc.own_score)
