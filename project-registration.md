# Project Registration — CPS-3320

**Course:** CPS 3320 — Python Programming  
**Group Members:** Daihong Luo, Xinzhi Bao  
**Date:** July 2, 2026

---

## Project Title

**The Cursed Canvas** — A Text-Based Adventure Across Masterpieces

---

## Key Idea

The Cursed Canvas is a browser-based text-adventure game in which the player wakes inside a magical museum at midnight, its doors sealed by an ancient curse. Three paintings—Van Gogh's *Starry Night*, Hokusai's *The Great Wave off Kanagawa*, and Monet's *Impression, Sunrise*—have become portal-like worlds whose colors and balance have been drained. The player steps into each painting, explores its dreamlike landscape, converses with the artist brought to life as an AI-driven NPC, and solves multi-step narrative puzzles to recover the lost artifacts that hold each artwork's soul. Only when all three paintings are restored do the museum doors open.

Under the hood, the game runs a three-tier command processing pipeline: a DeepSeek LLM serves as Dungeon Master for dynamic scene narration and NPC dialogue; a keyword-based rule engine provides fast fallback when the API is unavailable; and a trained TF-IDF + Logistic Regression classifier acts as the final safety net. The game is fully bilingual (English and Simplified Chinese), supports voice input with local Whisper STT and LLM-powered correction, and can be packaged as a desktop application via Electron + PyInstaller. The frontend features a cinematic title screen, an onboarding tutorial for first-time players, context-aware quick actions, a Restoration Gallery with art-historical context for each painting, and a save/load system with story recaps.

---

## Expected Outcome

By the end of this project, we expect to deliver a fully playable web-based game with three painting worlds, multi-step quest chains, AI-powered NPC dialogue, and a satisfying ending. The three-tier command processing system will demonstrate graceful degradation—when the DeepSeek API is unavailable, keyword rules and the ML classifier keep the game responsive, while an optional local Phi-3-mini model provides an offline AI path. The game will support complete bilingual play in English and Chinese, with 84 automated tests passing across engine logic, classification, API endpoints, and dialogue fallback chains. A desktop build for macOS and Windows will enable distribution to external playtesters without requiring Python setup.

---

## Impact

The Cursed Canvas sits at the intersection of gaming, art education, and artificial intelligence. For children, the game transforms art appreciation from passive viewing into active adventure: instead of being told Van Gogh's brushstrokes are expressive, a young player *walks into* the painting, searches the swirling village for a lost lantern, and speaks directly with the artist—making the art personal and memorable. For adults who have never engaged with art, the game provides a low-stakes, curiosity-driven entry point with no quizzes, no required background knowledge, and no wrong way to explore. The player learns about *The Great Wave* not by reading a placard but by standing on Hokusai's shore and asking the old master himself why he captured that moment. Each conversation with an artist-NPC becomes a miniature art history lesson delivered through natural dialogue rather than didactic instruction. By embedding art education inside the adventure game medium, The Cursed Canvas makes the world's most celebrated paintings accessible, personal, and genuinely fun to explore—allowing those who have never set foot in a gallery to develop genuine curiosity about art and the artists who created it.
