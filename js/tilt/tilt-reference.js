const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0]
];
const normalize = vector => {
  const length = Math.sqrt(dot(vector, vector));
  return vector.map(value => value / length);
};
const rotate = (vector, degrees) => {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine * vector[0] + sine * vector[1],
    -sine * vector[0] + cosine * vector[1],
    vector[2]
  ];
};
const normalizeAngle = angle => ((angle % 360) + 360) % 360;

export function validTiltReference(reference) {
  if (!reference || !Number.isFinite(reference.angle)
    || ![reference.u, reference.f, reference.r].every(vector => Array.isArray(vector)
      && vector.length === 3 && vector.every(Number.isFinite))) return false;
  if (![reference.u, reference.f, reference.r].every(vector => Math.hypot(...vector) > 0.5)) return false;

  const up = normalize(reference.u);
  const forward = normalize(reference.f);
  const right = normalize(reference.r);
  return Math.abs(dot(up, forward)) < 0.2
    && Math.abs(dot(up, right)) < 0.2
    && Math.abs(dot(forward, right)) < 0.2
    && dot(normalize(cross(forward, up)), right) > 0.8;
}

export function createTiltReference(upVector, screenAngle) {
  const up = normalize(upVector);
  const angle = normalizeAngle(screenAngle);
  const flat = Math.abs(up[2]) > 0.8;
  let forward = flat
    ? [[0, 1, 0], [1, 0, 0], [0, -1, 0], [-1, 0, 0]][Math.round(angle / 90) % 4]
    : [0, 0, -1];
  const projection = dot(forward, up);
  forward = normalize([
    forward[0] - projection * up[0],
    forward[1] - projection * up[1],
    forward[2] - projection * up[2]
  ]);
  const reference = { u: up, f: forward, r: normalize(cross(forward, up)), angle };
  return validTiltReference(reference) ? reference : null;
}

export function tiltReferenceAtAngle(reference, screenAngle) {
  const delta = ((normalizeAngle(screenAngle) - reference.angle + 540) % 360) - 180;
  if (Math.abs(delta) < 0.001) return reference;
  return {
    u: rotate(reference.u, delta),
    f: rotate(reference.f, delta),
    r: rotate(reference.r, delta),
    angle: normalizeAngle(screenAngle)
  };
}

export function calculateTiltAngles(upVector, reference) {
  const currentUp = normalize(upVector);
  const clamp = value => Math.max(-1, Math.min(1, value));
  return {
    pitch: Math.asin(clamp(dot(currentUp, reference.f))) * 180 / Math.PI,
    roll: -Math.asin(clamp(dot(currentUp, reference.r))) * 180 / Math.PI
  };
}
