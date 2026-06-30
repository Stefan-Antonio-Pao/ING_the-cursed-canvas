import unittest

from flask import g

from app import app, _classify_keyword_fallback
from engine.story_engine import GameState


class ChineseItemStateTests(unittest.TestCase):
    def setUp(self):
        self.ctx = app.app_context()
        self.ctx.push()
        g.lang = "zh"

    def tearDown(self):
        self.ctx.pop()

    def _starry_state(self):
        gs = GameState()
        gs.current_world = "starry_night"
        gs.visited_worlds.add("starry_night")
        gs._first_turn = False
        return gs

    def test_chinese_take_lantern_keyword(self):
        gs = self._starry_state()
        self.assertEqual(_classify_keyword_fallback("拿走灯笼", game_state=gs), "use_item")
        self.assertEqual(_classify_keyword_fallback("取下那盏灯", game_state=gs), "use_item")

    def test_scripted_use_item_takes_lantern_with_short_chinese_alias(self):
        gs = self._starry_state()
        response = gs.process("use_item", "（拿走灯笼）")
        self.assertIn("lantern", gs.inventory)
        self.assertIn("魔法灯笼", response["inventory"])

    def test_dm_intent_drift_still_awards_lantern(self):
        gs = self._starry_state()
        response = gs.process_dm_response({
            "intent": "explore",
            "scene": "你伸出手，握住那盏挂在木柱上的古老灯笼。",
            "npc_reply": "好极了！你拿到了那盏灯。",
            "npc_name": "文森特·梵高",
            "mood": "neutral",
            "move_target": None,
            "player_command": "（拿走灯笼）",
        })
        self.assertIn("lantern", gs.inventory)
        self.assertIn("魔法灯笼", response["inventory"])

    def test_lantern_reveals_then_take_yellow_pigment_in_chinese(self):
        gs = self._starry_state()
        gs.inventory.append("lantern")
        gs.items_found.add("lantern")

        gs.process_dm_response({
            "intent": "explore",
            "scene": "灯笼的光芒揭示了丝柏树后面的阴影壁龛，那里有一小管黄色颜料在闪烁。",
            "npc_reply": None,
            "npc_name": None,
            "mood": "neutral",
            "move_target": None,
            "player_command": "（用灯笼照亮丝柏树后面）",
        })
        self.assertIn("yellow_pigment", gs.revealed_items)
        self.assertNotIn("yellow_pigment", gs.inventory)

        response = gs.process_dm_response({
            "intent": "explore",
            "scene": "你伸出手，拿走那管黄色颜料。",
            "npc_reply": None,
            "npc_name": None,
            "mood": "neutral",
            "move_target": None,
            "player_command": "（拿走颜料）",
        })
        self.assertIn("yellow_pigment", gs.inventory)
        self.assertIn("失窃的黄色颜料", response["inventory"])

    def test_api_command_chinese_take_lantern_updates_inventory(self):
        with app.test_client() as client:
            client.post("/api/reset")
            with client.session_transaction() as session:
                session["lang"] = "zh"
                session["settings_language"] = "zh"
                session["llm_mode"] = "local"

            client.post("/api/command", json={"command": "（四处看看）"})
            move_response = client.post("/api/command", json={"command": "（进入星月夜）"})
            self.assertEqual(move_response.status_code, 200)
            self.assertEqual(move_response.json["location_id"], "starry_night")

            take_response = client.post("/api/command", json={"command": "（拿走灯笼）"})
            self.assertEqual(take_response.status_code, 200)
            self.assertIn("魔法灯笼", take_response.json["inventory"])


if __name__ == "__main__":
    unittest.main()
