/**
 * Embedded-terminal UI plugin, node half.
 *
 * Deliberately empty. The terminal wire domain lives in the host `apiproxy`
 * and the terminal object-layer state lives in the client `runtime`; this
 * browser package contributes only the page surface (launcher button + panel)
 * through the slot system, so its node half has no host-side registration.
 */

/** Host plugin body — no host-plane contribution. */
export function apply(): void {}
