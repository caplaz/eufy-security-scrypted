# Eufy Security Scrypted Plugin - Architecture

## 📁 Project Structure

```
src/
├── main.ts                    # Plugin entry point
├── eufy-provider.ts           # Main provider orchestration
├── eufy-station.ts            # Station device implementation
├── eufy-device.ts             # Camera/device implementation
│
├── services/                  # Business logic layer
│   ├── index.ts              # Service exports
│   ├── authentication/       # Authentication services
│   │   └── authentication-service.ts
│   ├── device/               # Device management services
│   ├── video/                # Video streaming and clips
│   │   └── video-clips-service.ts
│   ├── settings/             # Settings management
│   └── interfaces/           # Scrypted interface handlers
│       ├── light-control-handler.ts
│       └── ptz-control-handler.ts
│
├── utils/                    # Utilities and helpers
│   ├── console-logger.ts     # Logging infrastructure
│   ├── memory-manager.ts     # Memory management
│   ├── ffmpeg-utils.ts       # FFmpeg operations
│   ├── property-mapper.ts    # Property/settings mapping
│   ├── device-manifest-builder.ts  # Device manifest creation
│   └── scrypted-device-detection.ts
│
└── types/                    # TypeScript type definitions
    ├── index.ts
    ├── authentication.types.ts
    ├── video.types.ts
    └── device.types.ts
```

## 🎯 Design Principles

### 1. **Separation of Concerns**

- **Services**: Business logic and operations
- **Utils**: Pure functions and helpers
- **Types**: Type definitions and interfaces
- **Providers/Devices**: Scrypted integration layer

### 2. **Single Responsibility**

Each module has one clear purpose:

- `AuthenticationService`: Handles auth flow only
- `VideoClipsService`: Manages video clips only
- `LightControlHandler`: Controls lights only

### 3. **Dependency Injection**

Services receive dependencies via constructor:

```typescript
new AuthenticationService(wsClient, logger);
```

### 4. **Type Safety**

- Comprehensive TypeScript types
- No `any` types in public APIs
- Strict type checking enabled

### 5. **Testability**

- Services are easily mockable
- Clear interfaces for testing
- Unit tests for all services

## 🔧 Core Services

### Authentication Service

**Location**: `services/authentication/authentication-service.ts`

Handles all authentication operations:

- Connection to Eufy cloud
- CAPTCHA challenges
- MFA verification
- Authentication state management

**Usage**:

```typescript
const authService = new AuthenticationService(wsClient, logger);

// Connect
const result = await authService.connect();

// Handle CAPTCHA
if (authService.getState() === "captcha_required") {
  await authService.submitCaptcha(userCode);
}

// Subscribe to state changes
const unsubscribe = authService.onStateChange((state) => {
  console.log("Auth state:", state);
});
```

### Video Clips Service

**Location**: `services/video/video-clips-service.ts`

Manages video clip operations:

- Query clips from station database (P2P)
- Fallback to cloud API
- Pre-download thumbnails
- P2P downloads

**Usage**:

```typescript
const videoService = new VideoClipsService(wsClient, logger);

// Get clips
const clips = await videoService.getClips({
  serialNumber: "T1234",
  stationSerialNumber: "S5678",
  startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
  endTime: Date.now(),
});

// Download clip
const videoData = await videoService.downloadClip(clipId, serialNumber);
```

### Interface Handlers

**Location**: `services/interfaces/`

Encapsulate Scrypted interface implementations:

#### Light Control Handler

```typescript
const lightHandler = new LightControlHandler(wsClient, serialNumber, logger);
await lightHandler.turnOn();
await lightHandler.setBrightness(75);
```

#### PTZ Control Handler

```typescript
const ptzHandler = new PTZControlHandler(wsClient, serialNumber, logger);
await ptzHandler.tiltUp();
await ptzHandler.panRight();
```

## 🛠️ Utilities

### FFmpeg Utils

**Location**: `utils/ffmpeg-utils.ts`

FFmpeg operations with proper error handling:

```typescript
// Convert H.264 to JPEG
const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(h264Data, quality);

// Check FFmpeg availability
const isAvailable = await FFmpegUtils.isFFmpegAvailable();
```

### Property Mapper

**Location**: `utils/property-mapper.ts`

Maps between Eufy properties and Scrypted settings:

```typescript
// Convert to Scrypted setting
const setting = PropertyMapper.toSetting(metadata, value, description, group);

// Adjust value for API
const apiValue = PropertyMapper.adjustValueForAPI(uiValue, metadata);

// Get property group
const group = PropertyMapper.getPropertyGroup("lightBrightness");
// Returns: "Light"
```

### Device Manifest Builder

**Location**: `utils/device-manifest-builder.ts`

Builds Scrypted device manifests:

```typescript
// Build station manifest
const stationManifest = await DeviceManifestBuilder.buildStationManifest(
  wsClient,
  serialNumber
);

// Build device manifest
const deviceManifest = await DeviceManifestBuilder.buildDeviceManifest(
  wsClient,
  serialNumber
);

// Validate manifest
DeviceManifestBuilder.validateManifest(manifest);
```

## 📝 Type Definitions

### Authentication Types

```typescript
type AuthenticationState = "none" | "captcha_required" | "mfa_required";

interface CaptchaData {
  captchaId: string;
  captcha: string;
}

interface AuthenticationResult {
  success: boolean;
  driverConnected: boolean;
  error?: string;
}
```

### Video Types

```typescript
interface VideoClipMetadata {
  storage_path?: string;
  cipher_id?: number;
  thumb_path?: string;
  cloud_path?: string;
  cached_thumbnail?: Buffer;
  // ...
}

interface VideoClipQuery {
  serialNumber: string;
  stationSerialNumber: string;
  startTime: number;
  endTime: number;
}
```

## 🧪 Testing

All services include comprehensive unit tests:

```bash
# Run all tests
npm test

# Run specific test file
npm test -- authentication-service.test.ts

# Run tests in watch mode
npm test -- --watch
```

### Test Structure

```
tests/
├── setup.ts
└── unit/
    ├── services/
    │   └── authentication-service.test.ts
    └── eufy-device-ptz.test.ts
```

## 🚀 Migration Guide

### Old Code (device-utils.ts)

```typescript
// Before - everything in one file
const manifest = await DeviceUtils.createDeviceManifest(wsClient, serialNumber);
const jpegBuffer = await DeviceUtils.convertH264ToJPEG(h264Data);
```

### New Code (modular)

```typescript
// After - specialized modules
import { DeviceManifestBuilder } from "./utils/device-manifest-builder";
import { FFmpegUtils } from "./utils/ffmpeg-utils";

const manifest = await DeviceManifestBuilder.buildDeviceManifest(
  wsClient,
  serialNumber
);
const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(h264Data);
```

## 📚 Documentation Standards

All modules include:

- **Module docstring**: Purpose and responsibilities
- **Class docstring**: Overview of the class
- **Method docstrings**: Parameters, returns, examples
- **Type definitions**: All public interfaces

Example:

````typescript
/**
 * Authentication Service
 *
 * Manages Eufy cloud authentication including CAPTCHA and MFA challenges.
 *
 * @module services/authentication
 */
export class AuthenticationService {
  /**
   * Submit CAPTCHA solution
   *
   * @param code - The CAPTCHA code entered by the user
   * @returns Authentication result after CAPTCHA submission
   * @throws Error if code is empty or no CAPTCHA data available
   *
   * @example
   * ```typescript
   * const result = await authService.submitCaptcha('ABC123');
   * if (result.success) {
   *   console.log('CAPTCHA accepted!');
   * }
   * ```
   */
  async submitCaptcha(code: string): Promise<AuthenticationResult> {
    // Implementation...
  }
}
````

## 🔄 Development Workflow

1. **Create feature branch**

   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes**
   - Add service in `services/`
   - Add types in `types/`
   - Add utils in `utils/`

3. **Write tests**
   - Create test file in `tests/unit/`
   - Follow existing test patterns

4. **Run tests**

   ```bash
   npm test
   npm run lint
   npm run build
   ```

5. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   git push origin feature/my-feature
   ```

## 🎨 Code Style

- **Naming**: PascalCase for classes, camelCase for functions
- **Exports**: Named exports only (no default exports)
- **Async**: Always use async/await (no raw promises)
- **Errors**: Use Error objects with descriptive messages
- **Logging**: Use ConsoleLogger, not console.log

## 📊 Benefits of New Architecture

### Before Refactoring

- ❌ 1,400+ line files
- ❌ Mixed responsibilities
- ❌ Difficult to test
- ❌ Hard to maintain
- ❌ Code duplication

### After Refactoring

- ✅ Focused modules (<500 lines)
- ✅ Single responsibility
- ✅ Easily testable
- ✅ Maintainable
- ✅ Reusable services

## 🔜 Next Steps

1. **Complete Service Extraction**
   - Extract remaining functionality from eufy-device.ts
   - Create StreamService for video streaming
   - Create DevicePropertyService for property management

2. **Add More Tests**
   - VideoClipsService tests
   - Integration tests
   - E2E tests

3. **Documentation**
   - API documentation
   - Usage examples
   - Troubleshooting guide

4. **Performance**
   - Add caching strategies
   - Optimize memory usage
   - Profile and optimize hot paths

## 📖 Additional Resources

- [Scrypted Documentation](https://docs.scrypted.app/)
- [Eufy Security Client](https://github.com/bropat/eufy-security-ws)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Documentation](https://jestjs.io/)
