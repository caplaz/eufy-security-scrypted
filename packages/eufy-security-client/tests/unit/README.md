# Eufy Security WebSocket Client - Unit Tests

This directory contains comprehensive unit tests for all eufy-security-ws-client modules.

## Test Structure

### Core Module Tests

- **`client-state.test.ts`** - Tests for the centralized state management functionality
- **`websocket-client.test.ts`** - Tests for the low-level WebSocket connection management
- **`api-manager.test.ts`** - Tests for the high-level API management functionality
- **`types.test.ts`** - Tests for TypeScript type definitions and validation
- **`index.test.ts`** - Tests for the public API exports and module structure

### Test Coverage

Each test file covers:

#### ClientStateManager (`client-state.test.ts`)

- ✅ State initialization and management
- ✅ Connection state transitions
- ✅ Schema negotiation tracking
- ✅ Driver connection management
- ✅ State change subscriptions
- ✅ Error handling and recovery
- ✅ State cleanup and reset

#### WebSocketClient (`websocket-client.test.ts`)

- ✅ Connection lifecycle management
- ✅ Message sending and receiving
- ✅ Command timeout handling
- ✅ Event message processing
- ✅ Automatic reconnection logic
- ✅ Error handling and recovery
- ✅ State tracking integration

#### ApiManager (`api-manager.test.ts`)

- ✅ High-level API initialization
- ✅ Schema negotiation workflow
- ✅ Command execution with type safety
- ✅ Event listener management
- ✅ Driver connection management
- ✅ State management integration
- ✅ Error handling and logging

#### Types Module (`types.test.ts`)

- ✅ Type safety validation
- ✅ Interface structure enforcement
- ✅ JSON value type handling
- ✅ Event payload composition
- ✅ Device and state types
- ✅ Schema compatibility types

#### Public API (`index.test.ts`)

- ✅ Module export validation
- ✅ Public API surface verification
- ✅ TypeScript compatibility
- ✅ Instance creation testing
- ✅ Export structure validation

## Running Tests

### Run All Client Tests

```bash
npm test -- tests/unit/eufy-security-ws-client/
```

### Run Individual Test Files

```bash
# Client state management tests
npm test -- tests/unit/eufy-security-ws-client/client-state.test.ts

# WebSocket client tests
npm test -- tests/unit/eufy-security-ws-client/websocket-client.test.ts

# API manager tests
npm test -- tests/unit/eufy-security-ws-client/api-manager.test.ts

# Type definition tests
npm test -- tests/unit/eufy-security-ws-client/types.test.ts

# Public API tests
npm test -- tests/unit/eufy-security-ws-client/index.test.ts
```

### Run with Coverage

```bash
npm test -- --coverage tests/unit/eufy-security-ws-client/
```

## Test Features

### Mocking Strategy

- **WebSocket**: Mocked using `jest.mock('ws')` for connection testing
- **State Management**: Real instances for accurate state testing
- **Event Handlers**: Jest functions for callback verification
- **Timers**: Jest fake timers for timeout and reconnection testing

### Test Utilities

- **Setup/Teardown**: Proper cleanup in `beforeEach`/`afterEach`
- **Error Simulation**: Comprehensive error condition testing
- **State Validation**: Deep state checking with proper matchers
- **Type Safety**: Compile-time validation of TypeScript usage

### Key Testing Patterns

#### State Change Testing

```typescript
const callback = jest.fn();
stateManager.onStateChange(callback);
stateManager.setConnectionState(ConnectionState.CONNECTED);
expect(callback).toHaveBeenCalledWith(
  expect.objectContaining({
    connection: ConnectionState.CONNECTED,
  })
);
```

#### Event Filtering Testing

```typescript
const callback = jest.fn();
apiManager.addEventListener("device_event", callback, {
  source: "device",
  serialNumber: "T8210N20123456789",
});
// Verify only matching events trigger callback
```

#### Error Handling Testing

```typescript
const error = new Error("Test error");
mockWebSocketClient.connect.mockRejectedValue(error);
await expect(apiManager.connect()).rejects.toThrow("Test error");
```

## Test Quality Standards

- **100% Branch Coverage**: All code paths tested
- **Type Safety**: All TypeScript interfaces validated
- **Error Conditions**: Comprehensive error handling tests
- **Edge Cases**: Boundary conditions and race conditions tested
- **Integration**: Cross-module interaction testing
- **Performance**: Timeout and throttling behavior verified

## Continuous Integration

These tests are designed to run in CI/CD environments with:

- Fast execution (< 30 seconds total)
- No external dependencies
- Deterministic results
- Clear failure reporting
- Coverage reporting integration
