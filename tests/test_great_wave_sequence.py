import unittest

from flask import g

from app import app
from engine.story_engine import GameState


class GreatWaveSequenceTests(unittest.TestCase):
    def setUp(self):
        self.ctx = app.app_context()
        self.ctx.push()

    def tearDown(self):
        self.ctx.pop()

    def _state_with_flute(self, lang):
        g.lang = lang
        gs = GameState()
        gs.current_world = "great_wave"
        gs.visited_worlds.add("great_wave")
        gs.inventory.append("shell_flute")
        gs.items_found.add("shell_flute")
        gs._first_turn = False
        return gs

    def test_zh_blowing_flute_only_reveals_stone_even_if_dm_overclaims(self):
        gs = self._state_with_flute("zh")
        response = gs.process_dm_response({
            "intent": "use_item",
            "scene": "你吹响海螺笛，安宁石从岩石间显现并落入你手中。平衡已恢复。《神奈川冲浪里》画作已被修复。",
            "npc_reply": "二者已经完成了它的宿命。",
            "npc_name": "葛饰北斋",
            "mood": "hopeful",
            "move_target": None,
            "player_command": "（吹响笛子）",
        })

        self.assertIn("calming_stone", gs.revealed_items)
        self.assertNotIn("calming_stone", gs.inventory)
        self.assertFalse(gs.quests_completed["great_wave"])
        self.assertIn("安宁石已经显现", response["scene"])
        self.assertNotIn("画作已被修复", response["scene"])

    def test_zh_pickup_stone_after_reveal_does_not_complete_quest(self):
        gs = self._state_with_flute("zh")
        gs.revealed_items.add("calming_stone")

        response = gs.process_dm_response({
            "intent": "use_item",
            "scene": "你拾起安宁石。平衡已恢复，《神奈川冲浪里》画作已被修复。",
            "npc_reply": None,
            "npc_name": None,
            "mood": "neutral",
            "move_target": None,
            "player_command": "（拾取安宁石）",
        })

        self.assertIn("calming_stone", gs.inventory)
        self.assertFalse(gs.quests_completed["great_wave"])
        self.assertIn("安宁石", response["scene"])
        self.assertNotIn("画作已被修复", response["scene"])

    def test_zh_combined_harmony_after_pickup_completes_quest(self):
        gs = self._state_with_flute("zh")
        gs.inventory.append("calming_stone")
        gs.items_found.add("calming_stone")

        response = gs.process_dm_response({
            "intent": "use_item",
            "scene": "你让海螺笛与安宁石和鸣，浪峰开始放低。",
            "npc_reply": None,
            "npc_name": None,
            "mood": "hopeful",
            "move_target": None,
            "player_command": "（让海螺笛和安宁石和鸣）",
        })

        self.assertTrue(gs.quests_completed["great_wave"])
        self.assertIn("画作已被修复", response["scene"])

    def test_en_blowing_flute_only_reveals_stone_even_if_dm_overclaims(self):
        gs = self._state_with_flute("en")
        response = gs.process_dm_response({
            "intent": "use_item",
            "scene": "You blow the shell flute. The calming stone appears among the rocks and rests in your palm. Balance is restored. The Great Wave painting is restored.",
            "npc_reply": "The two have fulfilled their purpose.",
            "npc_name": "Katsushika Hokusai",
            "mood": "hopeful",
            "move_target": None,
            "player_command": "(blow the flute)",
        })

        self.assertIn("calming_stone", gs.revealed_items)
        self.assertNotIn("calming_stone", gs.inventory)
        self.assertFalse(gs.quests_completed["great_wave"])
        self.assertIn("not in your inventory yet", response["scene"])
        self.assertNotIn("painting is restored", response["scene"].lower())

    def test_scripted_blow_flute_after_pickup_still_does_not_complete(self):
        gs = self._state_with_flute("en")
        gs.inventory.append("calming_stone")
        gs.items_found.add("calming_stone")

        response = gs.process("use_item", "blow the flute")

        self.assertFalse(gs.quests_completed["great_wave"])
        self.assertNotIn("restored", response["scene"].lower())

    def test_scripted_use_both_together_completes(self):
        gs = self._state_with_flute("en")
        gs.inventory.append("calming_stone")
        gs.items_found.add("calming_stone")

        response = gs.process("use_item", "use the shell flute and calming stone together")

        self.assertTrue(gs.quests_completed["great_wave"])
        self.assertIn("restored", response["scene"].lower())

    def test_api_zh_full_great_wave_sequence_keeps_required_steps(self):
        g.lang = "zh"
        with app.test_client() as client:
            client.post("/api/reset")
            with client.session_transaction() as session:
                session["lang"] = "zh"
                session["settings_language"] = "zh"
                session["llm_mode"] = "local"

            client.post("/api/command", json={"command": "（四处看看）"})
            move = client.post("/api/command", json={"command": "（进入神奈川冲浪里）"})
            self.assertEqual(move.status_code, 200)
            self.assertEqual(move.json["location_id"], "great_wave")

            take_flute = client.post("/api/command", json={"command": "（捡起笛子）"})
            self.assertIn("海螺笛", take_flute.json["inventory"])
            self.assertNotIn("安宁石", take_flute.json["inventory"])
            self.assertFalse(take_flute.json["quests"]["great_wave"])

            blow_flute = client.post("/api/command", json={"command": "（吹响笛子）"})
            self.assertIn("海螺笛", blow_flute.json["inventory"])
            self.assertNotIn("安宁石", blow_flute.json["inventory"])
            self.assertFalse(blow_flute.json["quests"]["great_wave"])

            take_stone = client.post("/api/command", json={"command": "（拾取安宁石）"})
            self.assertIn("安宁石", take_stone.json["inventory"])
            self.assertFalse(take_stone.json["quests"]["great_wave"])

            harmony = client.post("/api/command", json={"command": "（让海螺笛和安宁石和鸣）"})
            self.assertTrue(harmony.json["quests"]["great_wave"])


if __name__ == "__main__":
    unittest.main()
