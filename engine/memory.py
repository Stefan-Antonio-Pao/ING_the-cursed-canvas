from collections import deque


class ContextMemory:
    def __init__(self, max_history=400, npc_history_max=200, transcript_max=1200):
        self.events = deque(maxlen=max_history)
        self.key_facts = {}
        self.npc_histories = {}
        self._npc_history_max = npc_history_max
        self.transcript = deque(maxlen=transcript_max)

    def add_event(self, text):
        self.events.append(text)

    def set_fact(self, key, value):
        self.key_facts[key] = value

    def get_fact(self, key, default=None):
        return self.key_facts.get(key, default)

    def add_npc_exchange(self, npc_id, speaker, text):
        if npc_id not in self.npc_histories:
            self.npc_histories[npc_id] = deque(maxlen=self._npc_history_max)
        self.npc_histories[npc_id].append((speaker, text))

    def get_npc_history(self, npc_id):
        return list(self.npc_histories.get(npc_id, []))

    def add_transcript_line(self, turn, location_id, speaker, text, line_type):
        if not text:
            return
        self.transcript.append(
            {
                "turn": int(turn),
                "location_id": location_id,
                "speaker": speaker,
                "text": text,
                "type": line_type,
            }
        )

    def get_transcript(self):
        return list(self.transcript)

    def recent_events_string(self, count=6):
        recent = list(self.events)[-count:]
        return "\n".join(f"- {e}" for e in recent) if recent else "(Nothing yet.)"

    def context_summary(self):
        loc = self.key_facts.get("location", "unknown")
        inv = self.key_facts.get("inventory", [])
        inv_s = ", ".join(inv) if inv else "nothing"
        quests = self.key_facts.get("quests", {})
        q_parts = [f"Quest '{w}': {'done' if d else 'not done'}" for w, d in quests.items()]
        return f"Location: {loc}\nInventory: {inv_s}\n" + "\n".join(q_parts)

    def to_dict(self):
        return {
            "events": list(self.events),
            "key_facts": dict(self.key_facts),
            "npc_histories": {npc_id: list(hist) for npc_id, hist in self.npc_histories.items()},
            "transcript": list(self.transcript),
        }

    @classmethod
    def from_dict(cls, d):
        mem = cls()
        if d:
            for e in d.get("events", []):
                mem.events.append(e)
            mem.key_facts = dict(d.get("key_facts", {}))
            for npc_id, hist in d.get("npc_histories", {}).items():
                mem.npc_histories[npc_id] = deque(hist, maxlen=mem._npc_history_max)
            for line in d.get("transcript", []):
                if isinstance(line, dict):
                    mem.transcript.append(line)
        return mem

    def reset(self):
        self.events.clear()
        self.key_facts.clear()
        self.npc_histories.clear()
        self.transcript.clear()
