import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EventBatch,
  StudyEvent,
  enumRegistry,
  eventSchemas,
  schemaRegistry,
} from "@eiai/schema";

const envelope = {
  event_id: "0f9b1a3c-7d2e-4c51-9a8b-2f6e4d1c8a90",
  session_id: "3b1d9e42-5a6f-4c8b-9d0e-1f2a3b4c5d6e",
  seq: 0,
  client_ts: "2026-08-09T10:00:00.000Z",
};

function itemPresented(overrides: Record<string, unknown> = {}) {
  return {
    ...envelope,
    type: "ITEM_PRESENTED",
    payload: { item_id: "item_03", position: 1 },
    ...overrides,
  };
}

describe("event envelope", () => {
  it("accepts a well-formed event", () => {
    expect(StudyEvent.safeParse(itemPresented()).success).toBe(true);
  });

  it("rejects a non-UUID event_id, since it is the idempotency key", () => {
    const result = StudyEvent.safeParse(itemPresented({ event_id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects a negative sequence number", () => {
    expect(StudyEvent.safeParse(itemPresented({ seq: -1 })).success).toBe(false);
  });

  it("rejects unknown top-level fields rather than silently dropping them", () => {
    const result = StudyEvent.safeParse(itemPresented({ participant_name: "Dasha" }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown payload fields", () => {
    const result = StudyEvent.safeParse(
      itemPresented({ payload: { item_id: "item_03", position: 1, email: "a@b.c" } }),
    );
    expect(result.success).toBe(false);
  });
});

describe("taxonomy coverage", () => {
  it("defines all 18 event types from the spec taxonomy", () => {
    expect(eventSchemas).toHaveLength(18);
  });

  it("exposes every defined event through the discriminated union", () => {
    const registered = schemaRegistry
      .find((section) => section.title === "Events")
      ?.entries.map((entry) => entry.name);
    expect(registered).toHaveLength(eventSchemas.length);
  });

  it("routes on `type` so a payload from the wrong event is rejected", () => {
    const wrongPayload = {
      ...envelope,
      type: "VERIFY_CLICKED",
      payload: { item_id: "item_03", position: 1 },
    };
    expect(StudyEvent.safeParse(wrongPayload).success).toBe(false);
  });
});

describe("field constraints that protect the measures", () => {
  it("bounds confidence to 0-100, since it is the register function's domain", () => {
    const base = {
      ...envelope,
      type: "CONFIDENCE_SET",
      payload: { item_id: "item_01", phase: "initial", value: 40 },
    };
    expect(StudyEvent.safeParse(base).success).toBe(true);
    expect(
      StudyEvent.safeParse({ ...base, payload: { ...base.payload, value: 101 } }).success,
    ).toBe(false);
    expect(
      StudyEvent.safeParse({ ...base, payload: { ...base.payload, value: -1 } }).success,
    ).toBe(false);
  });

  it("bounds scroll fraction to 0-1, since H4 depends on it being a fraction", () => {
    const base = {
      ...envelope,
      type: "RESPONSE_SCROLLED",
      payload: { item_id: "item_01", max_scroll_fraction: 1 },
    };
    expect(StudyEvent.safeParse(base).success).toBe(true);
    expect(
      StudyEvent.safeParse({
        ...base,
        payload: { ...base.payload, max_scroll_fraction: 1.5 },
      }).success,
    ).toBe(false);
  });

  it("allows a null register_state, because the neutral condition does not branch", () => {
    const neutral = {
      ...envelope,
      type: "RESPONSE_REVEALED",
      payload: {
        item_id: "item_01",
        response_id: "en_neutral_na_item_01",
        register_state: null,
      },
    };
    expect(StudyEvent.safeParse(neutral).success).toBe(true);
  });

  it("accepts a warm register_state", () => {
    const warm = {
      ...envelope,
      type: "RESPONSE_REVEALED",
      payload: {
        item_id: "item_01",
        response_id: "en_warm_low_item_01",
        register_state: "LOW",
      },
    };
    expect(StudyEvent.safeParse(warm).success).toBe(true);
  });

  it("rejects an item id outside item_01..item_12", () => {
    expect(StudyEvent.safeParse(itemPresented({ payload: { item_id: "item_13", position: 1 } })).success).toBe(false);
    expect(StudyEvent.safeParse(itemPresented({ payload: { item_id: "item_00", position: 1 } })).success).toBe(false);
  });
});

describe("event batch", () => {
  it("requires at least one event", () => {
    expect(EventBatch.safeParse({ events: [] }).success).toBe(false);
  });

  it("accepts a mixed batch", () => {
    const batch = {
      events: [
        itemPresented(),
        {
          ...envelope,
          event_id: "11111111-2222-4333-8444-555555555555",
          seq: 1,
          type: "VERIFY_CLICKED",
          payload: { item_id: "item_03", ms_since_reveal: 1200 },
        },
      ],
    };
    expect(EventBatch.safeParse(batch).success).toBe(true);
  });
});

describe("privacy invariant", () => {
  // The spec claims no PII anywhere in the log. This asserts it rather than
  // trusting it, across every schema the registry knows about.
  const forbidden = [
    "name",
    "email",
    "phone",
    "address",
    "dob",
    "birth_date",
    "birthdate",
    "ip",
    "ip_address",
    "postcode",
    "full_name",
    "age",
  ];

  function fieldNames(node: unknown, acc: Set<string> = new Set()): Set<string> {
    if (node === null || typeof node !== "object") return acc;
    const record = node as Record<string, unknown>;
    const properties = record["properties"];
    if (properties && typeof properties === "object") {
      for (const key of Object.keys(properties as Record<string, unknown>)) acc.add(key);
    }
    for (const value of Object.values(record)) {
      if (typeof value === "object") fieldNames(value, acc);
    }
    return acc;
  }

  it("declares no field whose name suggests personal data", () => {
    const offenders: string[] = [];

    for (const section of schemaRegistry) {
      for (const entry of section.entries) {
        const json = z.toJSONSchema(entry.schema, { io: "input", unrepresentable: "any" });
        for (const field of fieldNames(json)) {
          if (forbidden.includes(field)) offenders.push(`${entry.name}.${field}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("records age only as a band, never as a number", () => {
    const ageBand = enumRegistry.find((entry) => entry.name === "AgeBand");
    expect(ageBand).toBeDefined();
    const json = z.toJSONSchema(ageBand!.schema, { io: "input" }) as { enum?: unknown[] };
    expect(json.enum).toEqual(["14-15", "16-17", "18-24", "25+"]);
  });
});
