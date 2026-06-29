from engine.world_data import get_world, get_npc, get_item, get_default, load_world_data
from engine.memory import ContextMemory
import random
import re


def _normalize_artwork_titles(text):
    """Normalize known title mistranslations without touching visual wave descriptions."""
    if not isinstance(text, str) or not text:
        return text

    replacements = {
        "《巨浪》": "《神奈川冲浪里》",
        "《大浪》": "《神奈川冲浪里》",
        "巨浪画作": "《神奈川冲浪里》画作",
        "大浪画作": "《神奈川冲浪里》画作",
        "巨浪版画": "《神奈川冲浪里》版画",
        "大浪版画": "《神奈川冲浪里》版画",
        "巨浪世界": "《神奈川冲浪里》世界",
        "大浪世界": "《神奈川冲浪里》世界",
        "巨浪副本": "《神奈川冲浪里》副本",
        "大浪副本": "《神奈川冲浪里》副本",
        "巨浪画框": "《神奈川冲浪里》画框",
        "大浪画框": "《神奈川冲浪里》画框",
    }
    for wrong, correct in replacements.items():
        text = text.replace(wrong, correct)

    title_targets = "画作|版画|世界|副本|画框|展区|展厅"
    text = re.sub(
        rf"(进入|步入|走进|走入|前往|去往|离开|返回|回到)(?:那幅)?(?:巨浪|大浪)(?=({title_targets})?[，。！？、\s]|$)",
        r"\1《神奈川冲浪里》",
        text,
    )
    text = re.sub(
        r"(?:巨浪|大浪)(?=——我[^。！？\n]{0,16}(?:作品|创作|一笔))",
        "《神奈川冲浪里》中的海浪",
        text,
    )
    return text


class GameState:
    def __init__(self):
        self.current_world = "museum"
        self.inventory = []
        self.items_found = set()
        self.revealed_items = set()
        self.quests_completed = {"starry_night": False, "great_wave": False, "impression_sunrise": False}
        self.npcs_met = set()
        self.visited_worlds = {"museum"}
        self.game_complete = False
        self.turn_count = 0
        self.memory = ContextMemory()
        self._first_turn = True

    def to_dict(self):
        w = get_world(self.current_world)
        return {"location": w["name"] if w else self.current_world,
            "inventory": [get_item(i)["name"] for i in self.inventory] if self.inventory else [],
            "quests": dict(self.quests_completed), "game_over": self.game_complete, "victory": self.game_complete}

    def process(self, intent, command, ai_llm=None, sentiment=None):
        self.turn_count += 1
        world = get_world(self.current_world)
        if self._first_turn:
            self._first_turn = False
            scene = world["description"]
            self.memory.add_event(f"Entered {world['name']}.")
            npc_reply = None; npc_name = None
            if world["npcs"]:
                npc = get_npc(world["npcs"][0])
                npc_reply = npc["greeting"]; npc_name = npc["name"]
                self.npcs_met.add(world["npcs"][0])
                self.memory.add_npc_exchange(world["npcs"][0], npc_name, npc_reply)
            self._record_turn_transcript(command, scene, npc_reply, npc_name)
            return self._build_response(scene, npc_reply, npc_name, "neutral", intent)

        dispatch = {"explore": self._handle_explore, "talk": self._handle_talk,
            "use_item": self._handle_use_item, "solve": self._handle_solve,
            "help": self._handle_help, "move": self._handle_move, "inventory": self._handle_inventory}
        handler = dispatch.get(intent)
        if handler:
            args = [command, world]
            if intent in ("explore", "talk"): args.append(ai_llm)
            scene, npc_reply, npc_name = handler(*args)
        else:
            scene = f'You try "{command}" but nothing happens. Try looking around.'
            npc_reply, npc_name = None, None

        if all(self.quests_completed.values()) and not self.game_complete:
            self.game_complete = True
            self.memory.add_event("All paintings restored!")

        mood = sentiment(command) if sentiment else "neutral"
        self.memory.add_event(f"Player: {command}")
        current_world_data = get_world(self.current_world)
        self.memory.set_fact("location", current_world_data["name"] if current_world_data else self.current_world)
        self.memory.set_fact("inventory", list(self.inventory))
        self.memory.set_fact("quests", dict(self.quests_completed))
        self._record_turn_transcript(command, scene, npc_reply, npc_name)
        return self._build_response(scene, npc_reply, npc_name, mood, intent)

    def _handle_explore(self, command, world, ai_llm):
        # Scripted parts (items, exits, clues) are always shown
        parts = [world.get("short_desc", world["description"])]
        for item_id in world.get("items_available", []):
            item = get_item(item_id)
            if item and item_id not in self.items_found:
                parts.append(f"You notice a {item['name'].lower()} -- {item['description']}")
        if world.get("exits"):
            parts.append(" | ".join(ex["description"] for ex in world["exits"]))
        for item_id, hidden in world.get("items_hidden", {}).items():
            if hidden.get("reveal_item") in self.inventory and item_id not in self.items_found:
                parts.append(hidden["reveal_msg"])
                self.revealed_items.add(item_id)
        scene = " ".join(parts)
        # AI narration is appended as flavor on success; scripted clues stay
        if ai_llm:
            try:
                ai_scene = ai_llm.generate_scene(world["name"], world["description"], command)
                if ai_scene and len(ai_scene) > 15 and ai_scene != scene:
                    scene = scene + "\n\n" + ai_scene
            except Exception: pass
        return scene, None, None

    def _handle_talk(self, command, world, ai_llm):
        if not world["npcs"]: return get_default("talk_no_npc"), None, None
        npc_id = world["npcs"][0]; npc = get_npc(npc_id); npc_name = npc["name"]
        cmd_lower = command.lower()
        npc_reply = None
        history = self.memory.get_npc_history(npc_id)  # prior turns only
        system_prompt = npc.get("system_prompt") or npc.get("personality", "")

        # 1) Prefer AI dialogue when available (contextual, natural)
        if ai_llm:
            try:
                ai_reply, ok = ai_llm.generate_dialogue(
                    system_prompt, npc_name, history, command)
                if ok and ai_reply:
                    npc_reply = ai_reply
            except Exception: pass

        # 2) Smart static matching (fallback when AI absent or rejected)
        if npc_reply is None:
            npc_reply = self._match_npc_topic(cmd_lower, npc)
        if npc_reply is None:
            npc_reply = random.choice(npc.get("idle_lines", ["..."]))

        # Persist the full exchange (player + npc) for future context
        self.memory.add_npc_exchange(npc_id, "Player", command)
        self.memory.add_npc_exchange(npc_id, npc_name, npc_reply)
        return f"You talk to {npc_name}.", npc_reply, npc_name
    
    def _match_npc_topic(self, cmd_lower, npc):
        """Smart topic matching: specific keywords first, then generic questions."""
        # (a) Greeting detection
        if any(g in cmd_lower for g in ["hello","hi ","hey","greet","good morning","good evening"]):
            return npc.get("greeting")
        # (b) SPECIFIC keyword topics first (yellow, lantern, curse, wave, etc.)
        #     This ensures "why you lost your yellow?" matches "yellow" not generic "why"
        for topic, response in npc.get("talk_topics", {}).items():
            if topic in cmd_lower:
                return response
        # (c) Question-word routing (why/how/what/who/where) — generic fallback
        for qword, response in npc.get("question_topics", {}).items():
            if cmd_lower.startswith(qword) or qword in cmd_lower:
                return response
        return None

    def _handle_use_item(self, command, world):
        cmd_lower = command.lower()
        used_item_id = None
        def _match_item(iid):
            item = get_item(iid)
            return bool(item and self._mentions_item(iid, item, cmd_lower))
        for item_id in self.inventory:
            if _match_item(item_id): used_item_id = item_id; break
        if not used_item_id:
            for item_id in world.get("items_available", []):
                if _match_item(item_id): used_item_id = item_id; break
        if not used_item_id:
            for item_id, hidden in world.get("items_hidden", {}).items():
                if _match_item(item_id):
                    if (hidden.get("reveal_item") in self.inventory and
                        item_id not in self.items_found and
                        item_id in self.revealed_items and
                        self._looks_like_item_take_attempt(cmd_lower)):
                        used_item_id = item_id; break
        if not used_item_id: return get_default("item_not_recognized"), None, None
        item = get_item(used_item_id)
        if used_item_id not in self.inventory and used_item_id not in self.items_found:
            self.inventory.append(used_item_id); self.items_found.add(used_item_id)
            return item.get("pickup_msg", f"You pick up the {item['name']}."), None, None
        scene = f"You hold the {item['name'].lower()} -- {item['description']}"
        for hid_id, hidden in world.get("items_hidden", {}).items():
            if hidden.get("reveal_item") == used_item_id and hid_id not in self.items_found:
                scene += " " + hidden["reveal_msg"]
                self.revealed_items.add(hid_id)
                break
        qid = world.get("quest_goal")
        if qid and not self.quests_completed.get(self.current_world):
            # Starry Night: use yellow_pigment to complete quest
            if self.current_world == "starry_night" and "yellow_pigment" in self.inventory and used_item_id == "yellow_pigment":
                scene = world["quest_completion"]
                self.quests_completed[self.current_world] = True
                self.memory.add_event(f"Quest completed in {self.current_world}!")
            # Great Wave requires an explicit combined action, not merely replaying the flute.
            elif (self.current_world == "great_wave" and
                  "calming_stone" in self.inventory and
                  "shell_flute" in self.inventory and
                  self._player_attempted_world_solution(self.current_world, command)):
                scene = world["quest_completion"]
                self.quests_completed[self.current_world] = True
                self.memory.add_event(f"Quest completed in {self.current_world}!")
            elif (self.current_world == "impression_sunrise" and
                  "sunrise_pigment" in self.inventory and
                  used_item_id == "sunrise_pigment" and
                  self._player_attempted_world_solution(self.current_world, command)):
                scene = world["quest_completion"]
                self.quests_completed[self.current_world] = True
                self.memory.add_event(f"Quest completed in {self.current_world}!")
        return scene, None, None

    def _handle_solve(self, command, world):
        if not world.get("quest_goal"): return get_default("solve_not_ready"), None, None
        if self.quests_completed.get(self.current_world): return get_default("solve_already_done"), None, None
        cw = self.current_world
        can = (cw == "starry_night" and "yellow_pigment" in self.inventory) or \
              (cw == "great_wave" and "calming_stone" in self.inventory and "shell_flute" in self.inventory and
               self._player_attempted_world_solution(cw, command)) or \
              (cw == "impression_sunrise" and "sunrise_pigment" in self.inventory and
               self._player_attempted_world_solution(cw, command))
        if can:
            self.quests_completed[cw] = True
            self.memory.add_event(f"Quest completed in {cw}!")
            return world["quest_completion"], None, None
        return get_default("solve_not_ready"), None, None

    def _handle_help(self, command, world):
        if world.get("quest_goal") and not self.quests_completed.get(self.current_world):
            hint = world.get("quest_description", "")
            if world["npcs"]: hint += " " + get_npc(world["npcs"][0]).get("quest_hint", "")
            return hint, None, None
        return "Explore the museum and step into a painting to begin your quest.", None, None

    def _handle_move(self, command, world):
        cmd_lower = command.lower()
        cmd_words = cmd_lower.split()
        # Strong keyword aliases that map directly to worlds (checked first)
        strong = {"museum":"museum","gallery":"museum",
                  "starry":"starry_night","night":"starry_night","stars":"starry_night",
                  "swirling":"starry_night","van gogh":"starry_night",
                  "wave":"great_wave","kanagawa":"great_wave",
                  "hokusai":"great_wave","sea":"great_wave","ocean":"great_wave",
                  "impression":"impression_sunrise","sunrise":"impression_sunrise",
                  "monet":"impression_sunrise","harbor":"impression_sunrise",
                  "havre":"impression_sunrise","misty":"impression_sunrise"}
        for ex in world.get("exits", []):
            target = ex["target"]
            target_spaced = target.replace("_", " ")
            target_world = get_world(target)
            target_name = (target_world["name"].lower() if target_world else "")
            # Match: target ID, spaced ID, or full world name
            if target in cmd_lower or target_spaced in cmd_lower:
                return self._move_to_world(target)
            if target_name and target_name in cmd_lower:
                return self._move_to_world(target)
            # Strong keyword alias (e.g. "van gogh" -> starry_night, "wave" -> great_wave)
            # Only match single-word keywords in multi-word commands
            for kw, wid in strong.items():
                if kw in cmd_lower and target == wid:
                    kw_words = kw.split()
                    if len(kw_words) == 1 and len(cmd_words) < 2:
                        continue  # guard: don't match bare "wave" or "night"
                    return self._move_to_world(target)
            # Match on significant name words (both in command)
            if target_name:
                name_words = [w for w in target_name.split() if len(w) > 3]
                if len(name_words) >= 2 and all(w in cmd_lower for w in name_words):
                    return self._move_to_world(target)
        return "There's nowhere to go from here.", None, None

    def _handle_inventory(self, command, world):
        if not self.inventory: return "Your pockets are empty.", None, None
        return "You are carrying: " + ", ".join(get_item(i)["name"] for i in self.inventory), None, None

    def _move_to_world(self, target_id):
        target = get_world(target_id)
        if not target: return f"You can't go to {target_id}.", None, None
        self.current_world = target_id
        self.visited_worlds.add(target_id)
        self._first_turn = False
        scene = f"You step into the painting: {target['name']}.\n\n{target['description']}"
        npc_reply = None; npc_name = None
        if target["npcs"]:
            npc = get_npc(target["npcs"][0]); self.npcs_met.add(target["npcs"][0])
            npc_reply = npc["greeting"] if not self.quests_completed.get(target_id) else npc["quest_complete_reply"]
            npc_name = npc["name"]
            self.memory.add_npc_exchange(target["npcs"][0], npc_name, npc_reply)
        self.memory.add_event(f"Moved to {target['name']}.")
        if target_id == "museum" and all(self.quests_completed.values()):
            scene = scene + "\n\n" + get_default("game_complete")
        return scene, npc_reply, npc_name

    def process_dm_response(self, dm_result):
        """Process a DM-generated response and apply state changes safely.

        The DM generates the narrative, but this method owns the game state.
        It validates the DM's declared intent against actual game data before
        applying any mutations.

        Args:
            dm_result: Parsed dict from ai.dm_prompt.parse_dm_response().
                Keys: intent, scene, npc_reply, npc_name, mood, move_target

        Returns:
            Response dict in the same format as _build_response().
        """
        self.turn_count += 1
        intent = dm_result.get("intent", "explore")
        scene = dm_result.get("scene", "")
        npc_reply = dm_result.get("npc_reply")
        npc_name = dm_result.get("npc_name")
        mood = dm_result.get("mood", "neutral")
        move_target = dm_result.get("move_target")
        player_command = dm_result.get("player_command", "...")
        player_cmd_lower = player_command.lower()
        action_world_id = self.current_world

        # Normalize NPC names (DM may generate "HokusAI" instead of "Hokusai")
        _name_fixes = {"HokusAI": "Hokusai", "KokusAI": "Hokusai", "Kokusai": "Hokusai"}
        if npc_name:
            for wrong, correct in _name_fixes.items():
                npc_name = npc_name.replace(wrong, correct)
        if scene:
            for wrong, correct in _name_fixes.items():
                scene = scene.replace(wrong, correct)
        if npc_reply:
            for wrong, correct in _name_fixes.items():
                npc_reply = npc_reply.replace(wrong, correct)
        scene = _normalize_artwork_titles(scene)
        npc_reply = _normalize_artwork_titles(npc_reply)

        # Validate npc_name against actual NPC data
        world = get_world(self.current_world)
        if npc_name and world:
            valid_names = {get_npc(nid)["name"] for nid in world.get("npcs", []) if get_npc(nid)}
            if npc_name not in valid_names:
                for valid in valid_names:
                    if valid.lower() == npc_name.lower():
                        npc_name = valid
                        break

        # Apply state changes based on intent (validated)
        if intent == "move" and move_target:
            # Normalize move_target (DM might return "Starry Night" instead of "starry_night")
            move_target = move_target.lower().replace(" ", "_").replace("-", "_")
            
            # Reject move to current location
            if move_target == self.current_world:
                scene = (scene or "") + "\n\nYou are already here."
            else:
                # Validate the move target is a valid exit
                valid_exits = [ex["target"] for ex in world.get("exits", [])]
                if move_target in valid_exits:
                    target_world = get_world(move_target)
                    if target_world:
                        self.current_world = move_target
                        self.visited_worlds.add(move_target)
                        self._first_turn = False
                        self.memory.add_event(f"Moved to {target_world['name']}.")
                        # Show NPC greeting if present and quest not done
                        if target_world.get("npcs"):
                            npc = get_npc(target_world["npcs"][0])
                            if npc and not self.quests_completed.get(move_target):
                                self.npcs_met.add(target_world["npcs"][0])
                                npc_reply = npc["greeting"]
                                npc_name = npc["name"]
                                self.memory.add_npc_exchange(target_world["npcs"][0], npc["name"], npc_reply)
                        # Append ending text when returning to museum with all quests done
                        if move_target == "museum" and all(self.quests_completed.values()):
                            scene = (scene or "") + "\n\n" + get_default("game_complete")
                else:
                    # Invalid move target - provide feedback about available exits
                    exit_names = [get_world(ex["target"])["name"] for ex in world.get("exits", []) if get_world(ex["target"])]
                    if exit_names:
                        scene = (scene or "") + f"\n\nYou cannot go there from here. Available paths: {', '.join(exit_names)}."
                    else:
                        scene = (scene or "") + "\n\nThere are no obvious paths from here."

        elif intent == "use_item":
            scene_lower = (scene or "").lower()
            npc_lower = (npc_reply or "").lower()
            search_texts = [scene_lower, npc_lower, player_cmd_lower]

            def _item_mentioned(item_id, item):
                return any(
                    self._mentions_item(item_id, item, t)
                    for t in search_texts
                )

            for item_id in world.get("items_available", []):
                item = get_item(item_id)
                if item and item_id not in self.items_found:
                    if _item_mentioned(item_id, item):
                        self.inventory.append(item_id)
                        self.items_found.add(item_id)
                        break

        elif intent == "solve":
            # Only allow quest completion if player has required items
            cw = self.current_world
            can_solve = False
            if cw == "starry_night" and "yellow_pigment" in self.inventory:
                can_solve = True
            elif (cw == "great_wave" and
                  "calming_stone" in self.inventory and
                  "shell_flute" in self.inventory and
                  self._player_attempted_world_solution(cw, player_cmd_lower)):
                can_solve = True
            elif (cw == "impression_sunrise" and "sunrise_pigment" in self.inventory and
                  self._player_attempted_world_solution(cw, player_cmd_lower)):
                can_solve = True
            if can_solve and not self.quests_completed.get(cw):
                self.quests_completed[cw] = True
                self.memory.add_event(f"Quest completed in {cw}!")

        # Check for quest completion regardless of intent
        # (DM may classify quest completion as use_item, talk, or solve)
        cw = action_world_id
        cw_world = get_world(cw)
        if not self.quests_completed.get(cw):
            can_solve = False
            if cw == "starry_night" and "yellow_pigment" in self.inventory:
                can_solve = True
            elif (cw == "great_wave" and
                  "calming_stone" in self.inventory and
                  "shell_flute" in self.inventory):
                can_solve = True
            elif cw == "impression_sunrise" and "sunrise_pigment" in self.inventory:
                can_solve = True
            if can_solve:
                player_attempted_solution = self._player_attempted_world_solution(cw, player_cmd_lower)
                # Check if DM's response suggests quest completion
                scene_lower = (scene or "").lower()
                npc_lower = (npc_reply or "").lower()
                combined = scene_lower + " " + npc_lower + " " + player_cmd_lower
                
                # Expanded keyword list for quest completion detection
                quest_keywords = [
                    "restored", "complete", "solved", "returns", "sing again",
                    "calm", "soothe", "balance", "harmony", "free",
                    "blaze", "ignite", "light up", "shines", "glows",
                    "thank you", "grateful", "saved", "healed", "fixed",
                    "hand", "give", "return", "offer", "present",
                    "play", "melody", "music", "song", "flute",
                    "ripples", "gentle", "settles", "peace",
                    "sunrise", "orange", "reflection", "harbor", "dawn",
                    "mist", "glimmer", "gleam", "pigment",
                    "修复", "完成", "归还", "交给", "递给",
                    "点亮", "照亮", "恢复", "平息", "安抚",
                    "黄色", "颜料", "光", "太阳", "日出", "橙色",
                    "笛", "石", "海浪", "旋律", "音乐",
                    "和鸣", "共鸣", "合鸣", "合奏",
                    "harmony", "harmonize", "resonate", "resonance",
                    "duet", "together", "both"
                ]
                if player_attempted_solution and any(kw in combined for kw in quest_keywords):
                    self.quests_completed[cw] = True
                    self.memory.add_event(f"Quest completed in {cw}!")
                    if cw_world and cw_world.get("quest_completion"):
                        scene = cw_world["quest_completion"]

        # Sync item state from command/narration even if DM chose a non-item intent.
        awarded = self._sync_revealed_items(intent, world, player_cmd_lower, (scene or "") + " " + (npc_reply or ""))
        if awarded and self._looks_like_item_take_attempt(player_cmd_lower):
            pickup_lines = []
            for item_id in awarded:
                item = get_item(item_id)
                pickup_lines.append(item.get("pickup_msg") if item and item.get("pickup_msg") else f"You pick up {item_id.replace('_', ' ')}.")
            scene = " ".join(pickup_lines)

        if not self.quests_completed.get(action_world_id):
            scene, npc_reply = self._guard_premature_progress_claims(
                action_world_id,
                player_cmd_lower,
                scene,
                npc_reply,
            )

        # Store NPC conversation for talk intent
        if intent == "talk" and npc_reply and npc_name:
            for npc_id in world.get("npcs", []):
                npc = get_npc(npc_id)
                if npc and npc["name"] == npc_name:
                    self.memory.add_npc_exchange(npc_id, "Player", dm_result.get("player_command", "..."))
                    self.memory.add_npc_exchange(npc_id, npc_name, npc_reply)
                    break

        # Record events - use CURRENT world (after any moves)
        current_world_data = get_world(self.current_world)
        self.memory.add_event(f"Player: {player_command}")
        self.memory.set_fact("location", current_world_data["name"] if current_world_data else self.current_world)
        self.memory.set_fact("inventory", list(self.inventory))
        self.memory.set_fact("quests", dict(self.quests_completed))

        # Check for game completion (all quests done)
        if all(self.quests_completed.values()) and not self.game_complete:
            self.game_complete = True
            self.memory.add_event("All paintings restored!")

        self._record_turn_transcript(player_command, scene, npc_reply, npc_name)

        return self._build_response(scene, npc_reply, npc_name, mood, intent, response_type="dm")

    def _sync_revealed_items(self, intent, world, player_cmd_lower, narrative_text):
        """Keep inventory in sync when DM text reveals or player grabs an item.

        This protects gameplay from DM intent drift (e.g., command is interpreted
        as explore/talk while the player is clearly trying to pick up a revealed item).
        """
        if not world:
            return []
        narrative = (narrative_text or "").lower()
        awarded = []

        is_take_attempt = self._looks_like_item_take_attempt(player_cmd_lower)
        for item_id in world.get("items_available", []):
            item = get_item(item_id)
            if not item or item_id in self.items_found:
                continue
            mentioned_in_cmd = self._mentions_item(item_id, item, player_cmd_lower)
            pickup_in_narration = self._narration_signals_pickup(narrative) and self._mentions_item(item_id, item, narrative)
            should_award = pickup_in_narration or (is_take_attempt and mentioned_in_cmd) or (intent == "use_item" and mentioned_in_cmd)
            if should_award:
                self.inventory.append(item_id)
                self.items_found.add(item_id)
                awarded.append(item_id)

        for hid_id, hid_data in world.get("items_hidden", {}).items():
            if hid_id in self.items_found:
                continue
            was_revealed = hid_id in self.revealed_items
            reveal_item = hid_data.get("reveal_item", "")
            if reveal_item and reveal_item not in self.inventory:
                continue

            hid_item = get_item(hid_id)
            if not hid_item:
                continue

            hinted_by_narration = self._mentions_item(hid_id, hid_item, narrative)
            asked_by_command = self._mentions_item(hid_id, hid_item, player_cmd_lower) and is_take_attempt
            reveal_cues = any(
                cue in narrative
                for cue in [
                    "reveals",
                    "revealed",
                    "you notice",
                    "you spot",
                    "appears",
                    "emerges",
                    "materializes",
                    "glows",
                    "hums",
                    "gleams",
                    "glimmers",
                    "orange gleam",
                    "small, smooth pebble",
                    "揭示",
                    "显现",
                    "出现",
                    "露出",
                    "浮现",
                    "看见",
                    "发现",
                    "闪烁",
                    "发光",
                    "微光",
                    "映出",
                ]
            )

            if hinted_by_narration and reveal_cues:
                self.revealed_items.add(hid_id)

            can_take_revealed = asked_by_command and was_revealed

            if can_take_revealed:
                self.inventory.append(hid_id)
                self.items_found.add(hid_id)
                awarded.append(hid_id)

        return awarded

    def _guard_premature_progress_claims(self, world_id, player_cmd_lower, scene, npc_reply):
        """Keep narrative claims aligned with validated state progression."""
        if world_id != "great_wave":
            return scene, npc_reply

        combined = f"{scene or ''} {npc_reply or ''}".lower()
        stone = get_item("calming_stone")
        if not stone:
            return scene, npc_reply

        claimed_stone_pickup = (
            "calming_stone" not in self.inventory
            and self._mentions_item("calming_stone", stone, combined)
            and self._narration_signals_pickup(combined)
        )
        claimed_completion = (
            self._narrative_claims_quest_completion(world_id, combined)
            and not self._player_attempted_world_solution(world_id, player_cmd_lower)
        )

        if not (claimed_stone_pickup or claimed_completion):
            return scene, npc_reply

        lang_is_zh = self._contains_cjk(stone.get("name", ""))
        world = get_world(world_id)

        if "shell_flute" in self.inventory and "calming_stone" not in self.inventory:
            hidden = (world or {}).get("items_hidden", {}).get("calming_stone", {})
            self.revealed_items.add("calming_stone")
            reveal_msg = hidden.get("reveal_msg") or (
                "安宁石已经显现。" if lang_is_zh else "The calming stone is revealed."
            )
            reminder = (
                "安宁石已经显现，但还没有进入你的物品栏。你需要明确拾取它，之后再让海螺笛与安宁石和鸣。"
                if lang_is_zh
                else "The calming stone is visible, but it is not in your inventory yet. Pick it up before using it with the shell flute."
            )
            return f"{reveal_msg} {reminder}", None

        if "shell_flute" in self.inventory and "calming_stone" in self.inventory:
            reminder = (
                "海螺笛与安宁石彼此回应，但还没有真正和鸣。你需要明确同时使用二者，让旋律与静默合在一起。"
                if lang_is_zh
                else "The shell flute and calming stone answer each other, but they have not acted in harmony yet. Use them together to calm the wave."
            )
            return reminder, None

        return scene, npc_reply

    @staticmethod
    def _narrative_claims_quest_completion(world_id, narrative):
        if world_id != "great_wave":
            return False
        return any(
            cue in (narrative or "")
            for cue in [
                "painting is restored",
                "print is restored",
                "balance is restored",
                "quest completed",
                "restored.",
                "completed",
                "you have restored",
                "画作已被修复",
                "版画已被修复",
                "平衡已恢复",
                "副本完成",
                "任务完成",
                "已经修复",
                "已修复",
                "完成了它的宿命",
                "找回这幅画的安宁",
            ]
        )

    def _mentions_item(self, item_id, item, text):
        if not text:
            return False
        text = text.lower()
        for alias in self._item_aliases(item_id, item):
            if self._contains_cjk(alias):
                if alias in text:
                    return True
                continue
            if " " in alias:
                if alias in text:
                    return True
            else:
                if re.search(rf"\b{re.escape(alias)}\b", text):
                    return True
        return False

    @staticmethod
    def _contains_cjk(value):
        return bool(re.search(r"[\u3400-\u9fff]", value or ""))

    def _item_aliases(self, item_id, item):
        base = {
            item_id.lower(),
            item_id.replace("_", " ").lower(),
            item.get("name", "").lower(),
        }
        custom = {
            "calming_stone": {
                "stone", "calming stone", "calm stone", "smooth stone", "pebble",
                "安宁石", "石头", "石子", "石", "平静石", "镇静石"
            },
            "yellow_pigment": {
                "yellow", "pigment", "yellow pigment", "yellow paint", "paint tube",
                "黄色颜料", "黄颜料", "颜料", "黄色", "黄颜色", "黄色油彩", "颜料管"
            },
            "shell_flute": {
                "flute", "shell flute", "sea flute",
                "海螺笛", "螺笛", "笛子", "笛", "海螺", "贝壳笛"
            },
            "lantern": {
                "lantern", "enchanted lantern",
                "魔法灯笼", "灯笼", "灯", "古老灯笼", "铜灯笼", "魔法灯"
            },
            "mist_lens": {
                "lens", "mist lens", "glass lens", "fog lens",
                "雾透镜", "透镜", "镜片", "镜", "玻璃透镜", "雾镜"
            },
            "sunrise_pigment": {
                "sunrise", "sunrise pigment", "orange pigment", "orange", "vial", "sun pigment",
                "日出颜料", "日出", "橙色颜料", "橙色", "橙颜料", "颜料瓶", "小瓶"
            },
        }
        base.update(custom.get(item_id, set()))
        return {a.strip().lower() for a in base if a and a.strip()}

    @staticmethod
    def _looks_like_item_take_attempt(command):
        return any(
            v in command
            for v in [
                "take",
                "get",
                "pick",
                "grab",
                "collect",
                "obtain",
                "拿",
                "拿起",
                "拿走",
                "拿到",
                "取",
                "取走",
                "取得",
                "取下",
                "捡",
                "捡起",
                "拾起",
                "拾取",
                "收集",
                "获得",
                "抓住",
                "握住",
                "提起",
                "摘下",
            ]
        )

    @staticmethod
    def _narration_signals_pickup(narrative):
        return any(
            cue in narrative
            for cue in [
                "you pick up",
                "you lift",
                "you take",
                "you grab",
                "you collect",
                "you close your hand around",
                "rests in your palm",
                "你捡起",
                "你拿起",
                "你拿走",
                "你拿到",
                "你取走",
                "你取下",
                "你拾起",
                "你伸出手",
                "你握住",
                "握在手中",
                "落入你手中",
                "收入",
                "放进",
                "提起",
                "拿到了",
            ]
        )

    @staticmethod
    def _player_attempted_world_solution(world_id, command):
        cmd = (command or "").lower()
        if world_id == "great_wave":
            guidance_questions = [
                "how can i", "how do i", "what should i", "where should i",
                "can i", "could i", "should i", "tell me",
                "怎么", "如何", "我该", "能否", "可以", "告诉我", "哪里",
            ]
            if "?" in cmd or "？" in cmd or any(q in cmd for q in guidance_questions):
                return False

            has_flute = any(k in cmd for k in [
                "flute", "shell flute", "shell", "song", "melody",
                "笛", "笛子", "海螺笛", "海螺", "旋律", "乐声",
            ])
            has_stone = any(k in cmd for k in [
                "stone", "calming stone", "calm stone", "stillness",
                "石", "石头", "安宁石", "静默", "宁静",
            ])
            together = any(k in cmd for k in [
                "together", "both", "with the stone", "with stone", "with the flute",
                "combine", "unite", "duet", "harmony", "harmonize", "resonate",
                "resonance", "in unison", "as one", "concert",
                "一起", "同时", "二者", "两者", "它们", "和鸣", "共鸣",
                "合鸣", "合奏", "结合", "一同", "同用", "配合",
            ])
            solve_verb = any(v in cmd for v in [
                "calm", "soothe", "restore", "solve", "fix", "complete",
                "balance", "harmonize", "resonate",
                "平息", "安抚", "修复", "恢复", "解决", "完成",
                "平衡", "调和", "和鸣", "共鸣", "合鸣", "合奏",
            ])
            wave_target = any(k in cmd for k in [
                "wave", "sea", "ocean", "hokusai", "kanagawa",
                "海浪", "大海", "海洋", "北斋", "神奈川", "冲浪",
            ])
            standalone_harmony = any(k in cmd.strip() for k in [
                "duet", "harmony", "harmonize", "resonate",
                "和鸣", "共鸣", "合鸣", "合奏",
            ])

            if standalone_harmony:
                return True
            if together and (has_flute or has_stone or "them" in cmd or "它们" in cmd or "二者" in cmd or "两者" in cmd):
                return True
            if has_flute and has_stone and (together or solve_verb):
                return True
            if solve_verb and wave_target and together:
                return True
            return False
        if world_id == "starry_night":
            return (
                any(v in cmd for v in [
                    "use", "give", "return", "restore", "solve", "hand",
                    "使用", "交给", "递给", "归还", "还给", "修复", "解决", "交出", "递上"
                ])
                and any(k in cmd for k in [
                    "yellow", "pigment", "paint", "star",
                    "黄色", "颜料", "油彩", "星", "星星", "梵高"
                ])
            )
        if world_id == "impression_sunrise":
            guidance_questions = [
                "how can i",
                "how do i",
                "what should i",
                "where should i",
                "can i",
                "could i",
                "should i",
                "tell me",
                "怎么",
                "如何",
                "我该",
                "能否",
                "可以",
                "告诉我",
            ]
            if "?" in cmd or "？" in cmd or any(q in cmd for q in guidance_questions):
                return False
            return (
                any(v in cmd for v in [
                    "use", "give", "return", "restore", "solve", "hand", "touch", "paint", "apply", "shine", "color", "release",
                    "使用", "交给", "递给", "归还", "还给", "修复", "解决", "触碰", "涂", "照亮", "上色", "释放"
                ])
                and any(k in cmd for k in [
                    "sunrise", "sun", "orange", "pigment", "color", "light", "glow", "vial",
                    "日出", "太阳", "橙色", "颜料", "颜色", "光", "发光", "小瓶"
                ])
                and any(t in cmd for t in [
                    "sunrise", "sun", "sky", "canvas", "painting", "harbor", "monet", "together", "pigment",
                    "日出", "太阳", "天空", "画布", "画", "港口", "莫奈", "一起", "颜料"
                ])
            )
        return False

    def _record_turn_transcript(self, player_command, scene, npc_reply, npc_name):
        scene = _normalize_artwork_titles(scene)
        npc_reply = _normalize_artwork_titles(npc_reply)
        self.memory.add_transcript_line(
            turn=self.turn_count,
            location_id=self.current_world,
            speaker="Player",
            text=player_command,
            line_type="player_command",
        )
        if scene:
            self.memory.add_transcript_line(
                turn=self.turn_count,
                location_id=self.current_world,
                speaker="Narrator",
                text=scene,
                line_type="scene",
            )
        if npc_reply:
            self.memory.add_transcript_line(
                turn=self.turn_count,
                location_id=self.current_world,
                speaker=npc_name or "NPC",
                text=npc_reply,
                line_type="npc_reply",
            )

    def _build_response(self, scene, npc_reply, npc_name, mood, intent, response_type="keyword"):
        w = get_world(self.current_world)

        # Final name normalization safety net
        _name_fixes = {"HokusAI": "Hokusai", "KokusAI": "Hokusai", "Kokusai": "Hokusai"}
        if npc_name:
            for wrong, correct in _name_fixes.items():
                npc_name = npc_name.replace(wrong, correct)
        if scene:
            for wrong, correct in _name_fixes.items():
                scene = scene.replace(wrong, correct)
        if npc_reply:
            for wrong, correct in _name_fixes.items():
                npc_reply = npc_reply.replace(wrong, correct)
        scene = _normalize_artwork_titles(scene)
        npc_reply = _normalize_artwork_titles(npc_reply)

        # Build enriched response for the new UI
        exits_data = []
        if w:
            for ex in w.get("exits", []):
                target = get_world(ex["target"])
                exits_data.append({
                    "target": ex["target"],
                    "name": target["name"] if target else ex["target"],
                    "description": ex["description"]
                })

        npc_role = None
        if npc_name:
            # Look up NPC role from world data
            for nid, npc in (load_world_data().get("npcs", {}) or {}).items():
                if npc.get("name") == npc_name:
                    npc_role = npc.get("role")
                    break

        return {
            "scene": scene,
            "npc_reply": npc_reply,
            "npc_name": npc_name,
            "npc_role": npc_role,
            "mood": mood,
            "intent": intent,
            "response_type": response_type,
            "location": w["name"] if w else self.current_world,
            "location_id": self.current_world,
            "location_desc": w.get("short_desc", "") if w else "",
            "exits": exits_data,
            "inventory": [get_item(i)["name"] for i in self.inventory] if self.inventory else [],
            "quests": dict(self.quests_completed),
            "game_over": self.game_complete,
            "victory": self.game_complete,
            "all_quests_done": all(self.quests_completed.values())
        }
