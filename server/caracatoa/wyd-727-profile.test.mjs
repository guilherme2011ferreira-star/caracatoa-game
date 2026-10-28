import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectWyd727ClientFrame,
  inspectWyd727ServerFrame,
} from "./wyd-727-profile.mjs";

function packetBody(opcode, frameLength) {
  const body = Buffer.alloc(frameLength - 4);
  body.writeUInt16LE(opcode, 0);
  return body;
}

test("recognizes the documented WYDBot 7.27 session request shapes", () => {
  assert.deepEqual(inspectWyd727ClientFrame(packetBody(0x20d, 124)), {
    recognized: true,
    malformed: false,
    opcode: 0x20d,
    name: "account-login",
    frameLength: 124,
    expectedFrameLength: 124,
    lengthValid: true,
  });
  assert.equal(inspectWyd727ClientFrame(packetBody(0xfde, 32)).name, "token");
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x7f03, 16)).name,
    "caracatoa-attribute-allocation",
  );
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x7f05, 16)).name,
    "caracatoa-skill-learn",
  );
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x7f07, 16)).name,
    "caracatoa-equipment-change",
  );
  const mountAction = inspectWyd727ClientFrame(packetBody(0x7f0c, 52));
  assert.equal(mountAction.name, "caracatoa-mount-action");
  assert.equal(mountAction.lengthValid, true);
  assert.equal(inspectWyd727ClientFrame(packetBody(0x7f0c, 51)).lengthValid, false);
  assert.equal(inspectWyd727ClientFrame(packetBody(0x7f10, 52)).name, "caracatoa-refinement-action");
  assert.equal(inspectWyd727ClientFrame(packetBody(0x7f12, 52)).name, "caracatoa-stage-ritual");
  const shopAction = inspectWyd727ClientFrame(packetBody(0x7f22, 128));
  assert.equal(shopAction.name, "caracatoa-player-shop-action");
  assert.equal(shopAction.lengthValid, true);
  assert.equal(inspectWyd727ClientFrame(packetBody(0x7f22, 17)).lengthValid, false);
  assert.equal(inspectWyd727ClientFrame(packetBody(0x7f22, 4113)).lengthValid, false);
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x213, 36)).name,
    "request-character-entry",
  );
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x36c, 52)).name,
    "world-move",
  );
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x373, 36)).name,
    "world-item-use",
  );
  assert.equal(
    inspectWyd727ClientFrame(packetBody(0x3a0, 12)).name,
    "world-keepalive",
  );
});

test("flags known opcodes with a synthetic unexpected length without exposing fields", () => {
  assert.deepEqual(inspectWyd727ClientFrame(packetBody(0x20d, 125)), {
    recognized: true,
    malformed: false,
    opcode: 0x20d,
    name: "account-login",
    frameLength: 125,
    expectedFrameLength: 124,
    lengthValid: false,
  });
});

test("keeps unknown opcodes opaque and rejects a truncated WYD header", () => {
  assert.deepEqual(inspectWyd727ClientFrame(packetBody(0x777, 16)), {
    recognized: false,
    malformed: false,
    opcode: 0x777,
    frameLength: 16,
  });
  assert.deepEqual(inspectWyd727ClientFrame(Buffer.alloc(7)), {
    recognized: false,
    malformed: true,
    reason: "packet shorter than WYD header",
  });
});

test("checks server response sizes documented by the WYDBot client parsers", () => {
  const fixtures = [
    [0x105, 16, "server-message"],
    [0x10a, 2808, "login-successful"],
    [0x110, 1224, "resend-character-list"],
    [0x114, 2104, "character-to-world"],
    [0x181, 20, "compact-hp-mp-sync"],
    [0x182, 28, "inventory-slot-delta"],
    [0x364, 256, "create-mob"],
    [0x366, 52, "world-move-response"],
    [0x7f04, 52, "caracatoa-attribute-sync"],
    [0x7f06, 36, "caracatoa-skill-state"],
    [0x7f08, 22, "caracatoa-equipment-state"],
    [0x7f09, 36, "caracatoa-skill-effect-result"],
    [0x7f11, 28, "caracatoa-refinement-result"],
    [0x7f13, 40, "caracatoa-stage-state"],
  ];

  for (const [opcode, frameLength, name] of fixtures) {
    assert.deepEqual(
      inspectWyd727ServerFrame(packetBody(opcode, frameLength)),
      {
        recognized: true,
        malformed: false,
        opcode,
        name,
        frameLength,
        expectedFrameLength: frameLength,
        lengthKnown: true,
        lengthValid: true,
      },
    );
  }

  assert.equal(
    inspectWyd727ServerFrame(packetBody(0x10a, 2807)).lengthValid,
    false,
    "a one-byte-short synthetic login response must be rejected by the profile check",
  );
});

test("keeps token result lengths unknown when the client dispatches by opcode only", () => {
  for (const [opcode, name] of [
    [0xfde, "token-accepted"],
    [0xfdf, "token-incorrect"],
  ]) {
    for (const frameLength of [12, 13, 20]) {
      assert.deepEqual(
        inspectWyd727ServerFrame(packetBody(opcode, frameLength)),
        {
          recognized: true,
          malformed: false,
          opcode,
          name,
          frameLength,
          expectedFrameLength: null,
          lengthKnown: false,
          lengthValid: null,
        },
      );
    }
  }
});

test("mount state length stays variable because each snapshot carries a bounded list", () => {
  for (const frameLength of [20, 100, 184]) {
    const inspected = inspectWyd727ServerFrame(packetBody(0x7f0d, frameLength));
    assert.equal(inspected.name, "caracatoa-mount-state");
    assert.equal(inspected.lengthKnown, false);
    assert.equal(inspected.lengthValid, null);
  }
});
