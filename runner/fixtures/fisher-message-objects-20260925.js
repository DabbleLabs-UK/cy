// Captured production artifacts used only for deterministic reconciliation tests.
// No reconciliation is applied by importing this fixture.

function legacyObject(id, sourceEventId, updatedAt, visibility) {
  return {
    id,
    type: 'message',
    ownerId: 'fisher',
    holderId: 'cy',
    location: 'cell',
    status: 'DELIVERED',
    visibility,
    sourceEventId,
    updatedAt,
  };
}

export const FISHER_MESSAGE_OBJECT_FIXTURES = Object.freeze([
  {
    object: legacyObject(
      'object-38dde4bc-043e-443e-bbd4-a399721042f4',
      'world-67170c9a-feb9-4350-a461-764d77cd9626',
      '2026-09-25T05:43:06.892Z',
      [{ observerId: 'cy', access: 'CY_PARTIAL_HEARD', summary: "heard a voice claim 'keys not signed back in'" }],
    ),
    candidate: {
      decision: 'EVENT',
      eventFamily: 'OBJECT_TRANSFER',
      participants: ['cy', 'bill'],
      objective: { eventType: 'transfer_request', summary: 'Cy requested key transfer' },
      observations: [{ observerId: 'cy', access: 'CY_PARTIAL_HEARD', summary: 'Cy heard a voice.' }],
      informationClaims: [{ speakerId: 'bailey', content: 'keys not signed back in', truthStatus: 'UNKNOWN' }],
    },
    thread: { id: 'thread-77434047-f6f7-46be-86bb-e9aa06e31dbb' },
  },
  {
    object: legacyObject(
      'object-77e5a0cf-8b0e-4570-9092-0e5a2d3b238a',
      'world-30a3e330-a6e7-4ad5-a5f4-37b3d4ecb45a',
      '2026-09-25T07:36:14.513Z',
      [{ observerId: 'world', access: 'WORLD_ONLY', summary: 'Fisher approaches and starts a conversation' }],
    ),
    candidate: {
      decision: 'EVENT',
      eventFamily: 'SOCIAL_REQUEST',
      participants: ['cy', 'fisher'],
      objective: { eventType: 'social_request', summary: 'Fisher asks to discuss past conversations' },
      observations: [{ observerId: 'world', access: 'WORLD_ONLY', summary: 'Fisher approached the cell.' }],
      informationClaims: [],
    },
    thread: { id: 'thread-113cfaf0-7369-498d-8f6b-15ffe48f4cbe' },
  },
  {
    object: legacyObject(
      'object-0a48cfce-3207-408c-af84-35245c9c5a65',
      'world-e9474bc9-7020-4a57-983b-ebc09e2e267a',
      '2026-09-25T11:48:03.809Z',
      [{ observerId: 'world', access: 'WORLD_ONLY', summary: 'A message was delivered to Cy from Fisher in the cell.' }],
    ),
    candidate: {
      decision: 'EVENT',
      eventFamily: 'MESSAGE_PASSING',
      participants: ['cy', 'fisher'],
      objective: { eventType: 'message_exchange', summary: 'Fisher handed Cy a message.' },
      observations: [{ observerId: 'world', access: 'WORLD_ONLY', summary: 'A message was delivered to Cy from Fisher in the cell.' }],
      informationClaims: [{ speakerId: 'fisher', content: "Your sister's case is being reopened.", truthStatus: 'UNKNOWN' }],
    },
    thread: { id: 'thread-1bf406a1-195d-49de-b084-b095ac7149ca' },
  },
  {
    object: legacyObject(
      'object-b89dcdab-ea4a-4b1c-9243-36f2b3f23b31',
      'world-32fde141-3528-46f1-b962-b77436162606',
      '2026-09-25T14:18:23.909Z',
      [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy received the message.' }],
    ),
    candidate: {
      decision: 'EVENT',
      eventFamily: 'OBJECT_TRANSFER',
      participants: ['cy', 'fisher'],
      objective: { eventType: 'delivery', summary: 'Fisher handed Cy a new message.' },
      observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy received the message.' }],
      informationClaims: [{ speakerId: 'fisher', content: 'Past conversations need to be discussed.', truthStatus: 'UNKNOWN' }],
    },
    thread: { id: 'thread-bae0f823-5e70-48a4-b19e-58b38dde2a5c' },
  },
  {
    object: legacyObject(
      'object-161b0513-3132-435b-b702-c2b2db22d4dc',
      'world-0eb9350a-ed6e-4bde-a710-44dc4521fb8b',
      '2026-09-25T16:59:51.966Z',
      [{ observerId: 'cy', access: 'CY_DIRECT', summary: "I have received a message from Fisher, but I don't know its contents." }],
    ),
    candidate: {
      decision: 'CONTINUATION',
      eventFamily: 'MISTAKEN_DELIVERY',
      participants: ['cy', 'fisher'],
      objective: { eventType: 'misdelivery_report', summary: "Fishers' message with unknown content has been delivered by him to Cy." },
      observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: "I have received a message from Fisher, but I don't know its contents." }],
      informationClaims: [{ speakerId: 'fisher', content: 'unknown', truthStatus: 'UNKNOWN' }],
      continuationOf: { threadId: 'thread-1bf406a1-195d-49de-b084-b095ac7149ca' },
    },
    thread: { id: 'thread-1bf406a1-195d-49de-b084-b095ac7149ca' },
  },
]);
