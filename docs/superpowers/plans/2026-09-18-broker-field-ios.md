# Broker Field iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M1 slice of Broker Field — an iPhone app that records a broker's voice note, transcribes and extracts a structured enquiry on-device (Speech + Apple Foundation Models), and submits it to the existing `POST /api/leads` pipeline.

**Architecture:** Thin SwiftUI app over protocol-seamed services (`AudioRecording`, `SpeechTranscribing`, `EnquiryExtracting`, `LeadSubmitting`) so every stage is mockable and testable in the simulator. Local-first persistence via SwiftData before any network call; an outbox actor retries submissions with backoff. Spec: `docs/superpowers/specs/2026-09-18-broker-field-ios-design.md`.

**Tech Stack:** Swift 6, SwiftUI, SwiftData, FoundationModels (iOS 26), Speech, AVFoundation, XCTest. Zero third-party dependencies. Xcode 26.2 at `/Applications/Xcode.app`.

## Global Constraints

- Deployment target iOS 26.0, iPhone only (`TARGETED_DEVICE_FAMILY = 1`), Swift 6.0.
- All Swift/iOS work lives in `broker-field-ios/`; the Next.js apps are untouched. No backend changes.
- Bundle ids: `com.gentlespace.brokerfield` (app), `.tests` (unit), `.uitests` (UI).
- Backend base URL default `http://34.47.192.145` (verified live 2026-09-18: `POST /api/leads` with `{}` → 400). Overridable via `GSAPIBaseURL` in Info.plist. ATS exception is dogfood-only; flip to the HTTPS domain when apex DNS returns.
- `NeedType` values must stay `"office" | "retail" | "lease"` and step-2 keys must mirror `lib/leads/step2-fields.ts` verbatim (office: `teamSize`/`preferredArea`/`moveInTimeline`; retail: `frontageFootfall`/`preferredLocality`/`timeline`; lease: `propertySize`/`location`/`expectedRentTimeline`).
- `TIMELINE_BUCKETS` verbatim: `Immediate (this month)`, `1–3 months` (en dash U+2013), `3–6 months` (en dash), `Just exploring`.
- Never crash on model/speech/mic unavailability — every state degrades to a manual path.
- All builds/tests run via `xcodebuild` with `CODE_SIGNING_ALLOWED=NO` (simulator). On-device AFM validation is a manual gate at the end.
- Commit after every task. Work on branch `feat/broker-field-ios`.

## File Structure

```
broker-field-ios/
  .gitignore
  Info.plist
  BrokerField.xcodeproj/project.pbxproj   (3 targets, folder-synchronized — never edit per-file)
  BrokerField/
    BrokerFieldApp.swift                  entry point, AppEnvironment wiring
    AppEnvironment.swift                  production vs -UITesting service graph
    Theme.swift                           gsAccent color (#6840B8)
    Model/NeedType.swift                  NeedType + Step2Field + Step2Schema
    Model/PhoneNormalizer.swift
    Model/LeadPayload.swift
    Model/Enquiry.swift                   SwiftData @Model + EnquiryStatus
    Model/EnquiryDraft.swift              EnquiryDraft + EnquiryMapper
    Extraction/EnquiryExtraction.swift    @Generable struct
    Extraction/TranscriptTrimmer.swift
    Extraction/EnquiryExtracting.swift    protocol + ExtractorAvailability + MockExtractor
    Extraction/FoundationModelsExtractor.swift
    Recording/AudioRecording.swift        protocol + MockRecorder
    Recording/AudioRecorder.swift         actor over AVAudioRecorder
    Transcription/SpeechTranscribing.swift protocol + MockTranscriber
    Transcription/SpeechTranscriber.swift SFSpeechRecognizer, on-device, en-IN
    Session/RecordingSession.swift        @Observable orchestrator view model
    Sync/APIConfig.swift
    Sync/LeadSubmitting.swift             protocol + result + SubmitError + MockSubmitter
    Sync/LeadSubmitter.swift              URLSession POST /api/leads
    Sync/Outbox.swift                     Outbox actor + BackoffPolicy
    UI/RecordView.swift
    UI/ReviewSheet.swift
    UI/HistoryView.swift
    UI/EnquiryDetailView.swift
    UI/RootView.swift
  BrokerFieldTests/                       one suite per unit above
  BrokerFieldUITests/                     happy-path UI test via -UITesting harness
```

---

### Task 1: Project shell (verified scaffolding)

The `project.pbxproj` below uses Xcode 16+ folder-synchronized groups (`PBXFileSystemSynchronizedRootGroup`) so Swift files are never registered individually. This exact shape was spike-verified on this machine (2026-09-18): `xcodebuild -list`, simulator build, `xcodebuild test`, and a file-based Info.plist all pass.

**Files:**
- Create: `broker-field-ios/.gitignore`
- Create: `broker-field-ios/Info.plist`
- Create: `broker-field-ios/BrokerField.xcodeproj/project.pbxproj`
- Create: `broker-field-ios/BrokerField/BrokerFieldApp.swift`
- Create: `broker-field-ios/BrokerFieldTests/SanityTests.swift`
- Create: `broker-field-ios/BrokerFieldUITests/BrokerFieldUITests.swift`

**Interfaces:**
- Produces: the `BrokerField` scheme; `BrokerFieldTests` and `BrokerFieldUITests` test targets; every later task adds files under the synchronized folders only.

- [ ] **Step 1: Branch and folder**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git checkout -b feat/broker-field-ios
mkdir -p broker-field-ios/BrokerField.xcodeproj broker-field-ios/BrokerField broker-field-ios/BrokerFieldTests broker-field-ios/BrokerFieldUITests
```

- [ ] **Step 2: Write `.gitignore`**

```
xcuserdata/
DerivedData/
build/
*.xcuserstate
```

- [ ] **Step 3: Write `Info.plist`** (project root, deliberately outside the synchronized app folder)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Broker Field</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>NSMicrophoneUsageDescription</key>
	<string>Record voice notes after client calls and site visits.</string>
	<key>NSSpeechRecognitionUsageDescription</key>
	<string>Transcribe your voice notes on-device. Audio never leaves this iPhone.</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>
	<key>GSAPIBaseURL</key>
	<string>http://34.47.192.145</string>
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
	</dict>
	<key>UILaunchScreen</key>
	<dict/>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 4: Write `BrokerField.xcodeproj/project.pbxproj`**

```
// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {

		BB0000000000000000000001 /* PBXProject */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 2600;
				LastUpgradeCheck = 2600;
				TargetAttributes = {
					BB0000000000000000000002 = {
						CreatedOnToolsVersion = 26.0;
					};
					BB0000000000000000000012 = {
						CreatedOnToolsVersion = 26.0;
						TestTargetID = BB0000000000000000000002;
					};
					BB0000000000000000000022 = {
						CreatedOnToolsVersion = 26.0;
						TestTargetID = BB0000000000000000000002;
					};
				};
			};
			buildConfigurationList = BB0000000000000000000003 /* XCConfigurationList */;
			compatibilityVersion = "Xcode 15.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (en, Base);
			mainGroup = BB0000000000000000000004 /* PBXGroup */;
			productRefGroup = BB0000000000000000000005 /* PBXGroup */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				BB0000000000000000000002 /* BrokerField */,
				BB0000000000000000000012 /* BrokerFieldTests */,
				BB0000000000000000000022 /* BrokerFieldUITests */,
			);
		};

		BB0000000000000000000004 /* PBXGroup */ = {
			isa = PBXGroup;
			children = (
				BB0000000000000000000006 /* BrokerField */,
				BB0000000000000000000016 /* BrokerFieldTests */,
				BB0000000000000000000026 /* BrokerFieldUITests */,
				BB0000000000000000000005 /* Products */,
			);
			sourceTree = "<group>";
		};
		BB0000000000000000000005 /* Products */ = {
			isa = PBXGroup;
			children = (
				BB0000000000000000000007 /* BrokerField.app */,
				BB0000000000000000000017 /* BrokerFieldTests.xctest */,
				BB0000000000000000000027 /* BrokerFieldUITests.xctest */,
			);
			name = Products;
			sourceTree = "<group>";
		};

		BB0000000000000000000006 /* BrokerField */ = {
			isa = PBXFileSystemSynchronizedRootGroup;
			path = BrokerField;
			sourceTree = "<group>";
		};
		BB0000000000000000000016 /* BrokerFieldTests */ = {
			isa = PBXFileSystemSynchronizedRootGroup;
			path = BrokerFieldTests;
			sourceTree = "<group>";
		};
		BB0000000000000000000026 /* BrokerFieldUITests */ = {
			isa = PBXFileSystemSynchronizedRootGroup;
			path = BrokerFieldUITests;
			sourceTree = "<group>";
		};

		BB0000000000000000000002 /* BrokerField */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BB0000000000000000000008 /* XCConfigurationList */;
			buildPhases = (
				BB0000000000000000000009 /* Sources */,
				BB000000000000000000000A /* Frameworks */,
				BB000000000000000000000B /* Resources */,
			);
			buildRules = ();
			dependencies = ();
			fileSystemSynchronizedGroups = (
				BB0000000000000000000006 /* BrokerField */,
			);
			name = BrokerField;
			productName = BrokerField;
			productReference = BB0000000000000000000007 /* BrokerField.app */;
			productType = "com.apple.product-type.application";
		};
		BB0000000000000000000012 /* BrokerFieldTests */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BB0000000000000000000018 /* XCConfigurationList */;
			buildPhases = (
				BB0000000000000000000019 /* Sources */,
				BB000000000000000000001A /* Frameworks */,
				BB000000000000000000001B /* Resources */,
			);
			buildRules = ();
			dependencies = (
				BB000000000000000000001D /* PBXTargetDependency */,
			);
			fileSystemSynchronizedGroups = (
				BB0000000000000000000016 /* BrokerFieldTests */,
			);
			name = BrokerFieldTests;
			productName = BrokerFieldTests;
			productReference = BB0000000000000000000017 /* BrokerFieldTests.xctest */;
			productType = "com.apple.product-type.bundle.unit-test";
		};
		BB0000000000000000000022 /* BrokerFieldUITests */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BB0000000000000000000028 /* XCConfigurationList */;
			buildPhases = (
				BB0000000000000000000029 /* Sources */,
				BB000000000000000000002A /* Frameworks */,
				BB000000000000000000002B /* Resources */,
			);
			buildRules = ();
			dependencies = (
				BB000000000000000000002D /* PBXTargetDependency */,
			);
			fileSystemSynchronizedGroups = (
				BB0000000000000000000026 /* BrokerFieldUITests */,
			);
			name = BrokerFieldUITests;
			productName = BrokerFieldUITests;
			productReference = BB0000000000000000000027 /* BrokerFieldUITests.xctest */;
			productType = "com.apple.product-type.bundle.ui-testing";
		};

		BB0000000000000000000009 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000000A /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000000B /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB0000000000000000000019 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000001A /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000001B /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB0000000000000000000029 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000002A /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};
		BB000000000000000000002B /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		};

		BB0000000000000000000007 /* BrokerField.app */ = {
			isa = PBXFileReference;
			explicitFileType = wrapper.application;
			includeInIndex = 0;
			path = BrokerField.app;
			sourceTree = BUILT_PRODUCTS_DIR;
		};
		BB0000000000000000000017 /* BrokerFieldTests.xctest */ = {
			isa = PBXFileReference;
			explicitFileType = wrapper.cfbundle;
			includeInIndex = 0;
			path = BrokerFieldTests.xctest;
			sourceTree = BUILT_PRODUCTS_DIR;
		};
		BB0000000000000000000027 /* BrokerFieldUITests.xctest */ = {
			isa = PBXFileReference;
			explicitFileType = wrapper.cfbundle;
			includeInIndex = 0;
			path = BrokerFieldUITests.xctest;
			sourceTree = BUILT_PRODUCTS_DIR;
		};

		BB000000000000000000001D /* PBXTargetDependency */ = {
			isa = PBXTargetDependency;
			target = BB0000000000000000000002 /* BrokerField */;
		};
		BB000000000000000000002D /* PBXTargetDependency */ = {
			isa = PBXTargetDependency;
			target = BB0000000000000000000002 /* BrokerField */;
		};

		BB000000000000000000000C /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_TESTABILITY = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_DYNAMIC_NO_PIC = NO;
				GCC_NO_COMMON_BLOCKS = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				GCC_PREPROCESSOR_DEFINITIONS = ("DEBUG=1", "$(inherited)");
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				MTL_FAST_MATH = YES;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
			};
			name = Debug;
		};
		BB000000000000000000000D /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_NO_COMMON_BLOCKS = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MTL_ENABLE_DEBUG_INFO = NO;
				MTL_FAST_MATH = YES;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
		BB000000000000000000000E /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				INFOPLIST_FILE = Info.plist;
				LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks");
				MARKETING_VERSION = 0.1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
			};
			name = Debug;
		};
		BB000000000000000000000F /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				INFOPLIST_FILE = Info.plist;
				LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks");
				MARKETING_VERSION = 0.1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
			};
			name = Release;
		};
		BB000000000000000000001E /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				BUNDLE_LOADER = "$(TEST_HOST)";
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield.tests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = NO;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/BrokerField.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/BrokerField";
			};
			name = Debug;
		};
		BB000000000000000000001F /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				BUNDLE_LOADER = "$(TEST_HOST)";
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield.tests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = NO;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/BrokerField.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/BrokerField";
			};
			name = Release;
		};
		BB000000000000000000002E /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield.uitests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = NO;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
				TEST_TARGET_NAME = BrokerField;
			};
			name = Debug;
		};
		BB000000000000000000002F /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.gentlespace.brokerfield.uitests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_EMIT_LOC_STRINGS = NO;
				SWIFT_VERSION = 6.0;
				TARGETED_DEVICE_FAMILY = 1;
				TEST_TARGET_NAME = BrokerField;
			};
			name = Release;
		};

		BB0000000000000000000003 /* XCConfigurationList */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				BB000000000000000000000C /* Debug */,
				BB000000000000000000000D /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		BB0000000000000000000008 /* XCConfigurationList */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				BB000000000000000000000E /* Debug */,
				BB000000000000000000000F /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		BB0000000000000000000018 /* XCConfigurationList */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				BB000000000000000000001E /* Debug */,
				BB000000000000000000001F /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		BB0000000000000000000028 /* XCConfigurationList */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				BB000000000000000000002E /* Debug */,
				BB000000000000000000002F /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
	};
	rootObject = BB0000000000000000000001 /* PBXProject */;
}
```

- [ ] **Step 5: Write placeholder `BrokerField/BrokerFieldApp.swift`**

```swift
import SwiftUI

@main
struct BrokerFieldApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Broker Field")
        }
    }
}
```

- [ ] **Step 6: Write `BrokerFieldTests/SanityTests.swift`**

```swift
import XCTest
@testable import BrokerField

final class SanityTests: XCTestCase {
    func testHarnessRuns() {
        XCTAssertEqual(1 + 1, 2)
    }
}
```

- [ ] **Step 7: Write `BrokerFieldUITests/BrokerFieldUITests.swift`**

```swift
import XCTest

final class BrokerFieldUITests: XCTestCase {
    @MainActor
    func testAppLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Broker Field"].waitForExistence(timeout: 10))
    }
}
```

- [ ] **Step 8: Verify the shell builds and tests**

```bash
cd /Users/swami/Documents/GentleSpace_Web/broker-field-ios
xcodebuild -list -project BrokerField.xcodeproj
```

Expected: targets `BrokerField`, `BrokerFieldTests`, `BrokerFieldUITests`; scheme `BrokerField`.

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -20
```

Expected: `** TEST SUCCEEDED **`; `SanityTests.testHarnessRuns` passed; `BrokerFieldUITests.testAppLaunches` passed.

- [ ] **Step 9: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add broker-field-ios
git commit -m "Scaffold Broker Field iOS app (folder-synchronized Xcode project, 3 targets)."
```

---

### Task 2: Web-contract models (NeedType, Step2Schema, PhoneNormalizer, LeadPayload)

**Files:**
- Create: `broker-field-ios/BrokerField/Model/NeedType.swift`
- Create: `broker-field-ios/BrokerField/Model/PhoneNormalizer.swift`
- Create: `broker-field-ios/BrokerField/Model/LeadPayload.swift`
- Test: `broker-field-ios/BrokerFieldTests/Step2SchemaTests.swift`
- Test: `broker-field-ios/BrokerFieldTests/PhoneNormalizerTests.swift`
- Test: `broker-field-ios/BrokerFieldTests/LeadPayloadTests.swift`

**Interfaces:**
- Produces: `NeedType` (`office`/`retail`/`lease`), `Step2Schema.fields(for:)`, `Step2Schema.timelineBuckets`, `PhoneNormalizer.normalize(_:)` / `.isValid(_:)`, `LeadPayload` (Codable). Consumed by Tasks 3, 4, 7, 8, 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/Step2SchemaTests.swift
import XCTest
@testable import BrokerField

final class Step2SchemaTests: XCTestCase {
    func testOfficeKeysMatchWebContract() {
        XCTAssertEqual(Step2Schema.fields(for: .office).map(\.key),
                       ["teamSize", "preferredArea", "moveInTimeline"])
    }

    func testRetailKeysMatchWebContract() {
        XCTAssertEqual(Step2Schema.fields(for: .retail).map(\.key),
                       ["frontageFootfall", "preferredLocality", "timeline"])
    }

    func testLeaseKeysMatchWebContract() {
        XCTAssertEqual(Step2Schema.fields(for: .lease).map(\.key),
                       ["propertySize", "location", "expectedRentTimeline"])
    }

    func testTimelineBucketsMatchWebVerbatim() {
        XCTAssertEqual(Step2Schema.timelineBuckets,
                       ["Immediate (this month)", "1–3 months", "3–6 months", "Just exploring"])
    }

    func testChoiceFieldsAreFlagged() {
        XCTAssertTrue(Step2Schema.fields(for: .office).first { $0.key == "moveInTimeline" }!.isChoice)
        XCTAssertFalse(Step2Schema.fields(for: .office).first { $0.key == "teamSize" }!.isChoice)
    }
}
```

```swift
// BrokerFieldTests/PhoneNormalizerTests.swift
import XCTest
@testable import BrokerField

final class PhoneNormalizerTests: XCTestCase {
    func testTenDigitIndianNumberGetsCountryCode() {
        XCTAssertEqual(PhoneNormalizer.normalize("98765 43210"), "+919876543210")
    }

    func testAlreadyPrefixedNumberIsUnchanged() {
        XCTAssertEqual(PhoneNormalizer.normalize("+91 98765 43210"), "+919876543210")
    }

    func testLeadingZeroIsDropped() {
        XCTAssertEqual(PhoneNormalizer.normalize("09876543210"), "+919876543210")
    }

    func testTwelveDigit91NumberGetsPlus() {
        XCTAssertEqual(PhoneNormalizer.normalize("919876543210"), "+919876543210")
    }

    func testValidityWindow() {
        XCTAssertFalse(PhoneNormalizer.isValid("123"))
        XCTAssertTrue(PhoneNormalizer.isValid("+919876543210"))
        XCTAssertFalse(PhoneNormalizer.isValid(""))
    }
}
```

```swift
// BrokerFieldTests/LeadPayloadTests.swift
import XCTest
@testable import BrokerField

final class LeadPayloadTests: XCTestCase {
    func testEncodesWebContractKeys() throws {
        let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                  brief: "15 seats in Koramangala",
                                  step2Answers: ["preferredArea": "Koramangala"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        XCTAssertEqual(json["name"] as? String, "Asha Rao")
        XCTAssertEqual(json["phone"] as? String, "+919876543210")
        XCTAssertEqual(json["need"] as? String, "office")
        XCTAssertEqual(json["brief"] as? String, "15 seats in Koramangala")
        XCTAssertEqual((json["step2Answers"] as? [String: String])?["preferredArea"], "Koramangala")
        XCTAssertNil(json["propertyName"])
    }

    func testOmitsNilStep2Answers() throws {
        let payload = LeadPayload(name: "A", phone: "+919876543210", need: .retail, brief: "b")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        XCTAssertNil(json["step2Answers"])
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/swami/Documents/GentleSpace_Web/broker-field-ios
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — compile errors (`Cannot find 'Step2Schema' in scope` etc.).

- [ ] **Step 3: Implement the models**

```swift
// BrokerField/Model/NeedType.swift
import Foundation

/// Mirrors `NeedType` in `lib/whatsapp.ts` — raw values are the wire contract.
public enum NeedType: String, Codable, CaseIterable, Sendable {
    case office
    case retail
    case lease
}

/// One step-2 field, mirroring `Step2Field` in `lib/leads/step2-fields.ts`.
public struct Step2Field: Equatable, Sendable {
    public let key: String
    public let label: String
    public let isChoice: Bool

    public init(key: String, label: String, isChoice: Bool = false) {
        self.key = key
        self.label = label
        self.isChoice = isChoice
    }
}

/// Mirrors `STEP2_FIELDS` and `TIMELINE_BUCKETS` in `lib/leads/step2-fields.ts` verbatim.
public enum Step2Schema {
    public static let timelineBuckets = [
        "Immediate (this month)",
        "1\u{2013}3 months",
        "3\u{2013}6 months",
        "Just exploring",
    ]

    public static func fields(for need: NeedType) -> [Step2Field] {
        switch need {
        case .office:
            return [
                Step2Field(key: "teamSize", label: "Team size / desks"),
                Step2Field(key: "preferredArea", label: "Preferred area or corridor"),
                Step2Field(key: "moveInTimeline", label: "Move-in timeline", isChoice: true),
            ]
        case .retail:
            return [
                Step2Field(key: "frontageFootfall", label: "Frontage / footfall need"),
                Step2Field(key: "preferredLocality", label: "Preferred locality"),
                Step2Field(key: "timeline", label: "Timeline", isChoice: true),
            ]
        case .lease:
            return [
                Step2Field(key: "propertySize", label: "Property type & size"),
                Step2Field(key: "location", label: "Location"),
                Step2Field(key: "expectedRentTimeline", label: "Expected rent / timeline"),
            ]
        }
    }
}
```

```swift
// BrokerField/Model/PhoneNormalizer.swift
import Foundation

public enum PhoneNormalizer {
    /// Normalizes Indian field numbers to +91XXXXXXXXXX; leaves other
    /// international numbers as digits with a leading + when present.
    public static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPlus = trimmed.hasPrefix("+")
        let digits = trimmed.filter(\.isNumber)
        if !hasPlus, digits.count == 10 { return "+91" + digits }
        if !hasPlus, digits.count == 11, digits.hasPrefix("0") { return "+91" + digits.dropFirst() }
        if !hasPlus, digits.count == 12, digits.hasPrefix("91") { return "+" + digits }
        return hasPlus ? "+" + digits : digits
    }

    public static func isValid(_ normalized: String) -> Bool {
        let digits = normalized.filter(\.isNumber)
        return (10...15).contains(digits.count)
    }
}
```

```swift
// BrokerField/Model/LeadPayload.swift
import Foundation

/// Wire contract for `POST /api/leads` — mirrors `LeadPayload` in `lib/whatsapp.ts`.
public struct LeadPayload: Codable, Equatable, Sendable {
    public var name: String
    public var phone: String
    public var need: NeedType
    public var brief: String
    public var step2Answers: [String: String]?
    public var propertyName: String?
    public var propertyUrl: String?

    public init(name: String, phone: String, need: NeedType, brief: String,
                step2Answers: [String: String]? = nil,
                propertyName: String? = nil, propertyUrl: String? = nil) {
        self.name = name
        self.phone = phone
        self.need = need
        self.brief = brief
        self.step2Answers = step2Answers
        self.propertyName = propertyName
        self.propertyUrl = propertyUrl
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: `** TEST SUCCEEDED **` — 11 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add web-contract models (NeedType, Step2Schema, PhoneNormalizer, LeadPayload)."
```

---

### Task 3: SwiftData Enquiry model

**Files:**
- Create: `broker-field-ios/BrokerField/Model/Enquiry.swift`
- Test: `broker-field-ios/BrokerFieldTests/EnquiryModelTests.swift`

**Interfaces:**
- Consumes: `NeedType`, `PhoneNormalizer`, `LeadPayload` (Task 2).
- Produces: `Enquiry` (@Model), `EnquiryStatus`, `Enquiry.makePayload()`, `enquiry.status` / `enquiry.need` / `enquiry.step2Answers` accessors. Consumed by Tasks 7, 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/EnquiryModelTests.swift
import XCTest
import SwiftData
@testable import BrokerField

final class EnquiryModelTests: XCTestCase {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    func testPersistsAndFetches() throws {
        let context = ModelContext(try makeContainer())
        let enquiry = Enquiry(transcript: "t", name: "Asha Rao", phone: "+919876543210",
                              need: .office, brief: "b", step2Answers: ["preferredArea": "Koramangala"])
        context.insert(enquiry)
        try context.save()
        let fetched = try context.fetch(FetchDescriptor<Enquiry>())
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched[0].name, "Asha Rao")
        XCTAssertEqual(fetched[0].need, .office)
        XCTAssertEqual(fetched[0].step2Answers["preferredArea"], "Koramangala")
        XCTAssertEqual(fetched[0].status, .draft)
    }

    func testMakePayloadRequiresNamePhoneNeed() {
        let incomplete = Enquiry(name: "", phone: "123", need: nil, brief: "b")
        XCTAssertNil(incomplete.makePayload())

        let complete = Enquiry(name: "Asha Rao", phone: "98765 43210", need: .retail, brief: "b",
                               step2Answers: ["preferredLocality": "Indiranagar"])
        let payload = complete.makePayload()
        XCTAssertEqual(payload?.phone, "+919876543210")
        XCTAssertEqual(payload?.need, .retail)
        XCTAssertEqual(payload?.step2Answers?["preferredLocality"], "Indiranagar")
    }

    func testEmptyStep2AnswersBecomeNil() {
        let enquiry = Enquiry(name: "A", phone: "9876543210", need: .lease, brief: "b")
        XCTAssertNil(enquiry.makePayload()?.step2Answers)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/EnquiryModelTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'Enquiry' in scope`.

- [ ] **Step 3: Implement the model**

```swift
// BrokerField/Model/Enquiry.swift
import Foundation
import SwiftData

public enum EnquiryStatus: String, Codable, Sendable {
    case draft
    case queued
    case submitted
    case failed
}

@Model
public final class Enquiry {
    public var id: UUID = UUID()
    public var createdAt: Date = Date()
    public var audioFileName: String?
    public var transcript: String = ""
    public var name: String = ""
    public var phone: String = ""
    public var needRaw: String?
    public var brief: String = ""
    public var step2AnswersJSON: String = "{}"
    public var statusRaw: String = EnquiryStatus.draft.rawValue
    public var serverEnquiryId: String?
    public var serverTier: String?
    public var lastError: String?
    public var attemptCount: Int = 0
    public var nextAttemptAt: Date?

    public init(audioFileName: String? = nil, transcript: String = "", name: String = "",
                phone: String = "", need: NeedType? = nil, brief: String = "",
                step2Answers: [String: String] = [:]) {
        self.audioFileName = audioFileName
        self.transcript = transcript
        self.name = name
        self.phone = phone
        self.needRaw = need?.rawValue
        self.brief = brief
        self.step2Answers = step2Answers
    }

    public var status: EnquiryStatus {
        get { EnquiryStatus(rawValue: statusRaw) ?? .draft }
        set { statusRaw = newValue.rawValue }
    }

    public var need: NeedType? {
        get { needRaw.flatMap(NeedType.init(rawValue:)) }
        set { needRaw = newValue?.rawValue }
    }

    public var step2Answers: [String: String] {
        get {
            (try? JSONDecoder().decode([String: String].self, from: Data(step2AnswersJSON.utf8))) ?? [:]
        }
        set {
            let data = (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8)
            step2AnswersJSON = String(data: data, encoding: .utf8) ?? "{}"
        }
    }

    /// Builds the `/api/leads` payload, or nil when the enquiry is incomplete.
    public func makePayload() -> LeadPayload? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let need, !trimmedName.isEmpty else { return nil }
        let normalized = PhoneNormalizer.normalize(phone)
        guard PhoneNormalizer.isValid(normalized) else { return nil }
        let answers = step2Answers
        return LeadPayload(name: trimmedName, phone: normalized, need: need, brief: brief,
                           step2Answers: answers.isEmpty ? nil : answers)
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add SwiftData Enquiry model with payload builder."
```

---

### Task 4: Extraction types, mapper, transcript trimmer

**Files:**
- Create: `broker-field-ios/BrokerField/Extraction/EnquiryExtraction.swift`
- Create: `broker-field-ios/BrokerField/Extraction/TranscriptTrimmer.swift`
- Create: `broker-field-ios/BrokerField/Model/EnquiryDraft.swift`
- Test: `broker-field-ios/BrokerFieldTests/EnquiryMapperTests.swift`
- Test: `broker-field-ios/BrokerFieldTests/TranscriptTrimmerTests.swift`

**Interfaces:**
- Consumes: `NeedType`, `Step2Schema` (Task 2).
- Produces: `EnquiryExtraction` (@Generable), `EnquiryDraft`, `EnquiryMapper.draft(from:)` / `.timelineBucket(_:)`, `TranscriptTrimmer.truncate(_:maxChars:)`. Consumed by Tasks 5, 7, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/EnquiryMapperTests.swift
import XCTest
@testable import BrokerField

final class EnquiryMapperTests: XCTestCase {
    private func extraction(need: String? = nil, budget: String? = nil,
                            localities: [String] = [], timeline: String? = nil,
                            brief: String = "b") -> EnquiryExtraction {
        EnquiryExtraction(contactName: "Asha Rao", phone: "98765 43210", need: need,
                          budget: budget, localities: localities, timeline: timeline, brief: brief)
    }

    func testOfficeMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "office",
                                                         localities: ["Koramangala", "HSR"],
                                                         timeline: "next month"))
        XCTAssertEqual(draft.name, "Asha Rao")
        XCTAssertEqual(draft.need, .office)
        XCTAssertEqual(draft.step2Answers["preferredArea"], "Koramangala, HSR")
        XCTAssertEqual(draft.step2Answers["moveInTimeline"], "1\u{2013}3 months")
    }

    func testRetailMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "retail",
                                                         localities: ["Indiranagar"],
                                                         timeline: "immediate"))
        XCTAssertEqual(draft.need, .retail)
        XCTAssertEqual(draft.step2Answers["preferredLocality"], "Indiranagar")
        XCTAssertEqual(draft.step2Answers["timeline"], "Immediate (this month)")
    }

    func testLeaseFoldsBudgetAndTimeline() {
        let draft = EnquiryMapper.draft(from: extraction(need: "lease", budget: "Rs 80/sqft",
                                                         localities: ["Whitefield"], timeline: "immediate"))
        XCTAssertEqual(draft.need, .lease)
        XCTAssertEqual(draft.step2Answers["location"], "Whitefield")
        XCTAssertEqual(draft.step2Answers["expectedRentTimeline"], "Rs 80/sqft, immediate")
    }

    func testLeaseInferenceWinsOverOfficeMention() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Client wants to lease out my property, an office floor"))
        XCTAssertEqual(draft.need, .lease)
    }

    func testRetailInferenceFromKeywords() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Looking for a showroom with high-street frontage"))
        XCTAssertEqual(draft.need, .retail)
    }

    func testUnknownNeedStaysNil() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Exploring the market"))
        XCTAssertNil(draft.need)
        XCTAssertTrue(draft.step2Answers.isEmpty)
    }

    func testTimelineBuckets() {
        XCTAssertEqual(EnquiryMapper.timelineBucket("asap"), "Immediate (this month)")
        XCTAssertEqual(EnquiryMapper.timelineBucket("in 2 months"), "1\u{2013}3 months")
        XCTAssertEqual(EnquiryMapper.timelineBucket("3-6 months"), "3\u{2013}6 months")
        XCTAssertEqual(EnquiryMapper.timelineBucket("just exploring"), "Just exploring")
        XCTAssertNil(EnquiryMapper.timelineBucket("someday"))
        XCTAssertNil(EnquiryMapper.timelineBucket(nil))
    }
}
```

```swift
// BrokerFieldTests/TranscriptTrimmerTests.swift
import XCTest
@testable import BrokerField

final class TranscriptTrimmerTests: XCTestCase {
    func testShortTranscriptPassesThrough() {
        let result = TranscriptTrimmer.truncate("hello", maxChars: 100)
        XCTAssertEqual(result.text, "hello")
        XCTAssertFalse(result.wasTruncated)
    }

    func testLongTranscriptIsMarked() {
        let long = String(repeating: "a", count: 500)
        let result = TranscriptTrimmer.truncate(long, maxChars: 100)
        XCTAssertTrue(result.wasTruncated)
        XCTAssertTrue(result.text.hasPrefix(String(repeating: "a", count: 100)))
        XCTAssertTrue(result.text.contains("truncated"))
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/EnquiryMapperTests \
  -only-testing:BrokerFieldTests/TranscriptTrimmerTests \
  test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — compile errors for missing types.

- [ ] **Step 3: Implement**

```swift
// BrokerField/Extraction/EnquiryExtraction.swift
import Foundation
import FoundationModels

/// Structured output of the on-device model. The @Guide descriptions are part
/// of the model's schema prompt — keep them factual and short.
@Generable
public struct EnquiryExtraction: Equatable, Sendable {
    @Guide(description: "Contact's full name, if spoken")
    public var contactName: String?

    @Guide(description: "Contact phone number as spoken, if any")
    public var phone: String?

    @Guide(description: "Exactly one of: office, retail, lease. office = client wants office or coworking space; retail = shop or showroom; lease = client wants to lease out their own property")
    public var need: String?

    @Guide(description: "Budget, seat price, or rent figure mentioned, verbatim")
    public var budget: String?

    @Guide(description: "Localities, areas, or corridors mentioned")
    public var localities: [String]

    @Guide(description: "Move-in or decision timeline, if mentioned")
    public var timeline: String?

    @Guide(description: "Two or three sentence factual summary of the requirement. Only facts stated in the transcript.")
    public var brief: String

    public init(contactName: String? = nil, phone: String? = nil, need: String? = nil,
                budget: String? = nil, localities: [String] = [], timeline: String? = nil,
                brief: String) {
        self.contactName = contactName
        self.phone = phone
        self.need = need
        self.budget = budget
        self.localities = localities
        self.timeline = timeline
        self.brief = brief
    }
}
```

```swift
// BrokerField/Extraction/TranscriptTrimmer.swift
import Foundation

public enum TranscriptTrimmer {
    /// The on-device session context is small (~4k tokens shared with
    /// instructions and output). ~10k chars ≈ 2.5k tokens of headroom-safe input.
    public static let maxTranscriptChars = 10_000

    public static func truncate(_ transcript: String,
                                maxChars: Int = maxTranscriptChars) -> (text: String, wasTruncated: Bool) {
        guard transcript.count > maxChars else { return (transcript, false) }
        let cut = transcript.prefix(maxChars)
        return (String(cut) + "\n[truncated — first \(maxChars) of \(transcript.count) chars]", true)
    }
}
```

```swift
// BrokerField/Model/EnquiryDraft.swift
import Foundation

/// Editable pre-submission form of an enquiry — what the review sheet edits.
public struct EnquiryDraft: Equatable, Sendable {
    public var name: String
    public var phone: String
    public var need: NeedType?
    public var brief: String
    public var step2Answers: [String: String]

    public init(name: String = "", phone: String = "", need: NeedType? = nil,
                brief: String = "", step2Answers: [String: String] = [:]) {
        self.name = name
        self.phone = phone
        self.need = need
        self.brief = brief
        self.step2Answers = step2Answers
    }
}

public enum EnquiryMapper {
    public static func draft(from extraction: EnquiryExtraction) -> EnquiryDraft {
        let need = inferNeed(from: extraction)
        var answers: [String: String] = [:]
        let area = extraction.localities
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        switch need {
        case .office:
            if !area.isEmpty { answers["preferredArea"] = area }
            if let bucket = timelineBucket(extraction.timeline) { answers["moveInTimeline"] = bucket }
        case .retail:
            if !area.isEmpty { answers["preferredLocality"] = area }
            if let bucket = timelineBucket(extraction.timeline) { answers["timeline"] = bucket }
        case .lease:
            if !area.isEmpty { answers["location"] = area }
            let rentTimeline = [extraction.budget, extraction.timeline]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
            if !rentTimeline.isEmpty { answers["expectedRentTimeline"] = rentTimeline }
        case nil:
            break
        }
        return EnquiryDraft(
            name: extraction.contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            phone: extraction.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            need: need,
            brief: extraction.brief.trimmingCharacters(in: .whitespacesAndNewlines),
            step2Answers: answers)
    }

    static func inferNeed(from extraction: EnquiryExtraction) -> NeedType? {
        if let raw = extraction.need?.lowercased().trimmingCharacters(in: .whitespaces),
           let need = NeedType(rawValue: raw) {
            return need
        }
        let haystack = ([extraction.brief] + extraction.localities
            + [extraction.budget ?? "", extraction.timeline ?? ""])
            .joined(separator: " ")
            .lowercased()
        // Order matters: "lease out my property" often also mentions office space.
        if haystack.contains("lease out") || haystack.contains("rent out")
            || haystack.contains("my property") || haystack.contains("landlord") {
            return .lease
        }
        if haystack.contains("retail") || haystack.contains("showroom")
            || haystack.contains("frontage") || haystack.contains("high street")
            || haystack.contains("high-street") || haystack.contains("shop") {
            return .retail
        }
        if haystack.contains("office") || haystack.contains("desk") || haystack.contains("seat")
            || haystack.contains("cowork") || haystack.contains("workspace") {
            return .office
        }
        return nil
    }

    /// Maps free-text timelines to the web's TIMELINE_BUCKETS; nil when nothing
    /// matches (the text still survives in the brief — nothing is lost).
    public static func timelineBucket(_ timeline: String?) -> String? {
        guard let timeline else { return nil }
        let t = timeline.lowercased()
        if t.contains("immediate") || t.contains("asap") || t.contains("this month")
            || t.contains("urgent") || t.contains("right away") {
            return Step2Schema.timelineBuckets[0]
        }
        if t.contains("1-3") || t.contains("1\u{2013}3") || t.contains("next month")
            || t.contains("quarter") || t.contains("2 month") || t.contains("two month") {
            return Step2Schema.timelineBuckets[1]
        }
        if t.contains("3-6") || t.contains("3\u{2013}6") || t.contains("6 month")
            || t.contains("six month") || t.contains("half year") {
            return Step2Schema.timelineBuckets[2]
        }
        if t.contains("explor") || t.contains("no rush") || t.contains("flexible") {
            return Step2Schema.timelineBuckets[3]
        }
        return nil
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — mapper 7 tests + trimmer 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add @Generable extraction type, draft mapper, transcript trimmer."
```

---

### Task 5: Extractor seam + FoundationModels extractor

**Files:**
- Create: `broker-field-ios/BrokerField/Extraction/EnquiryExtracting.swift`
- Create: `broker-field-ios/BrokerField/Extraction/FoundationModelsExtractor.swift`
- Test: `broker-field-ios/BrokerFieldTests/ExtractorAvailabilityTests.swift`

**Interfaces:**
- Consumes: `EnquiryExtraction`, `TranscriptTrimmer` (Task 4).
- Produces: `EnquiryExtracting` protocol, `ExtractorAvailability`, `ExtractionError`, `MockExtractor`, `FoundationModelsExtractor`. Consumed by Tasks 7, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/ExtractorAvailabilityTests.swift
import XCTest
import FoundationModels
@testable import BrokerField

final class ExtractorAvailabilityTests: XCTestCase {
    func testMapsFrameworkAvailability() {
        XCTAssertEqual(FoundationModelsExtractor.mapAvailability(.available), .available)
        XCTAssertEqual(FoundationModelsExtractor.mapAvailability(.unavailable(.deviceNotEligible)),
                       .deviceNotEligible)
        XCTAssertEqual(FoundationModelsExtractor.mapAvailability(.unavailable(.appleIntelligenceNotEnabled)),
                       .appleIntelligenceOff)
        XCTAssertEqual(FoundationModelsExtractor.mapAvailability(.unavailable(.modelNotReady)),
                       .modelNotReady)
    }

    func testMockExtractorRecordsTranscript() async throws {
        let expected = EnquiryExtraction(contactName: "Asha Rao", brief: "b")
        let mock = MockExtractor(result: .success(expected))
        XCTAssertEqual(mock.availability(), .available)
        let result = try await mock.extract(from: "some transcript")
        XCTAssertEqual(result, expected)
        XCTAssertEqual(mock.lastTranscript, "some transcript")
    }

    func testMockExtractorCanFail() async {
        let mock = MockExtractor(result: .failure(ExtractionError.guardrailViolation))
        await XCTAssertThrowsErrorAsync(await mock.extract(from: "x")) { error in
            XCTAssertEqual(error as? ExtractionError, .guardrailViolation)
        }
    }
}

/// XCTest has no built-in async throws assertion — tiny local helper.
func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ message: String = "",
    file: StaticString = #filePath, line: UInt = #line,
    _ errorHandler: (Error) -> Void
) async {
    do {
        _ = try await expression()
        XCTFail("Expected error to be thrown. \(message)", file: file, line: line)
    } catch {
        errorHandler(error)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/ExtractorAvailabilityTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'MockExtractor' in scope` etc.

- [ ] **Step 3: Implement**

```swift
// BrokerField/Extraction/EnquiryExtracting.swift
import Foundation

public enum ExtractorAvailability: Equatable, Sendable {
    case available
    case appleIntelligenceOff
    case deviceNotEligible
    case modelNotReady
    case unavailable(String)
}

public enum ExtractionError: Error, Equatable, Sendable {
    case unavailable
    case guardrailViolation
    case contextOverflow
    case failed(String)
}

/// The model seam — the Swift analog of the web app's `aiProvider()` facade.
/// v0.1 has one implementation (on-device AFM); PCC or AFM 3 Core Advanced
/// slot in later without touching call sites.
public protocol EnquiryExtracting: Sendable {
    func availability() -> ExtractorAvailability
    func extract(from transcript: String) async throws -> EnquiryExtraction
}

/// Test double. `lastTranscript` is mutated only from `extract`, which tests
/// await — the lock keeps Swift 6 strict concurrency happy.
public final class MockExtractor: EnquiryExtracting, @unchecked Sendable {
    public var stubbedAvailability: ExtractorAvailability
    public var stubbedResult: Result<EnquiryExtraction, Error>
    private let lock = NSLock()
    private var _lastTranscript: String?

    public var lastTranscript: String? {
        lock.lock()
        defer { lock.unlock() }
        return _lastTranscript
    }

    public init(availability: ExtractorAvailability = .available,
                result: Result<EnquiryExtraction, Error>) {
        self.stubbedAvailability = availability
        self.stubbedResult = result
    }

    public func availability() -> ExtractorAvailability { stubbedAvailability }

    public func extract(from transcript: String) async throws -> EnquiryExtraction {
        lock.lock()
        _lastTranscript = transcript
        lock.unlock()
        return try stubbedResult.get()
    }
}
```

```swift
// BrokerField/Extraction/FoundationModelsExtractor.swift
import Foundation
import FoundationModels

public struct FoundationModelsExtractor: EnquiryExtracting {
    public init() {}

    public func availability() -> ExtractorAvailability {
        Self.mapAvailability(SystemLanguageModel.default.availability)
    }

    static func mapAvailability(_ availability: SystemLanguageModel.Availability) -> ExtractorAvailability {
        switch availability {
        case .available:
            return .available
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled: return .appleIntelligenceOff
            case .deviceNotEligible: return .deviceNotEligible
            case .modelNotReady: return .modelNotReady
            @unknown default: return .unavailable("unknown")
            }
        }
    }

    public func extract(from transcript: String) async throws -> EnquiryExtraction {
        guard availability() == .available else { throw ExtractionError.unavailable }
        let trimmed = TranscriptTrimmer.truncate(transcript)
        let session = LanguageModelSession(instructions: Self.instructions)
        do {
            let response = try await session.respond(to: Self.prompt(for: trimmed.text),
                                                     generating: EnquiryExtraction.self)
            return response.content
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .guardrailViolation:
                throw ExtractionError.guardrailViolation
            case .exceededContextWindowSize:
                throw ExtractionError.contextOverflow
            default:
                throw ExtractionError.failed(String(describing: error))
            }
        } catch {
            throw ExtractionError.failed(String(describing: error))
        }
    }

    static let instructions = """
        You extract a structured commercial-real-estate enquiry from a broker's \
        voice-note transcript. Rules: use only facts stated in the transcript; \
        never invent names, phone numbers, areas, or figures; leave a field empty \
        when the transcript does not state it; need is 'office' when the client \
        wants office or coworking space, 'retail' for shops or showrooms, 'lease' \
        when the client wants to lease out their own property. The brief is two \
        or three factual sentences.
        """

    static func prompt(for transcript: String) -> String {
        "Transcript:\n\"\"\"\n\(transcript)\n\"\"\""
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add EnquiryExtracting seam with on-device FoundationModels extractor."
```

---

### Task 6: Recording + transcription services

**Files:**
- Create: `broker-field-ios/BrokerField/Recording/AudioRecording.swift`
- Create: `broker-field-ios/BrokerField/Recording/AudioRecorder.swift`
- Create: `broker-field-ios/BrokerField/Transcription/SpeechTranscribing.swift`
- Create: `broker-field-ios/BrokerField/Transcription/SpeechTranscriber.swift`
- Test: `broker-field-ios/BrokerFieldTests/RecordingServicesTests.swift`

**Interfaces:**
- Produces: `AudioRecording` protocol + `MockRecorder`, `SpeechTranscribing` protocol + `MockTranscriber`, `RecordingError`, `TranscriptionError`. Consumed by Task 7 and Task 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/RecordingServicesTests.swift
import XCTest
@testable import BrokerField

final class RecordingServicesTests: XCTestCase {
    func testMockRecorderLifecycle() async throws {
        let recorder = MockRecorder()
        XCTAssertTrue(await recorder.requestPermission())
        let url = try await recorder.startRecording()
        XCTAssertTrue(url.lastPathComponent.hasSuffix(".m4a"))
        XCTAssertTrue(await recorder.isRecording)
        let stopped = try await recorder.stopRecording()
        XCTAssertEqual(stopped, url)
        XCTAssertFalse(await recorder.isRecording)
    }

    func testMockRecorderStopWithoutStartThrows() async {
        let recorder = MockRecorder()
        await XCTAssertThrowsErrorAsync(await recorder.stopRecording()) { error in
            XCTAssertEqual(error as? RecordingError, .notRecording)
        }
    }

    func testMockRecorderPermissionDenied() async {
        let recorder = MockRecorder(grantPermission: false)
        XCTAssertFalse(await recorder.requestPermission())
    }

    func testMockTranscriberReturnsStubbedTranscript() async throws {
        let transcriber = MockTranscriber(transcript: "hello world")
        XCTAssertTrue(await transcriber.requestAuthorization())
        let text = try await transcriber.transcribe(url: URL(fileURLWithPath: "/tmp/x.m4a"))
        XCTAssertEqual(text, "hello world")
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/RecordingServicesTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — missing types.

- [ ] **Step 3: Implement**

```swift
// BrokerField/Recording/AudioRecording.swift
import Foundation

public enum RecordingError: Error, Equatable, Sendable {
    case permissionDenied
    case failedToStart
    case notRecording
}

public protocol AudioRecording: Sendable {
    var isRecording: Bool { get async }
    func requestPermission() async -> Bool
    func startRecording() async throws -> URL
    func stopRecording() async throws -> URL
}

/// Test double — never touches the microphone.
public actor MockRecorder: AudioRecording {
    public private(set) var isRecording = false
    private let grantPermission: Bool
    private var currentURL: URL?

    public init(grantPermission: Bool = true) {
        self.grantPermission = grantPermission
    }

    public func requestPermission() async -> Bool { grantPermission }

    public func startRecording() async throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString + ".m4a")
        currentURL = url
        isRecording = true
        return url
    }

    public func stopRecording() async throws -> URL {
        guard let url = currentURL else { throw RecordingError.notRecording }
        currentURL = nil
        isRecording = false
        return url
    }
}
```

```swift
// BrokerField/Recording/AudioRecorder.swift
import AVFoundation
import Foundation

/// Records AAC .m4a into the app's Documents/recordings folder.
/// AVAudioRecorder is not Sendable — the actor keeps it on one isolation.
public actor AudioRecorder: AudioRecording {
    public private(set) var isRecording = false
    private var recorder: AVAudioRecorder?
    private var currentURL: URL?

    public init() {}

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func startRecording() async throws -> URL {
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appending(path: "recordings", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: UUID().uuidString + ".m4a")

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: file, settings: settings)
        guard recorder.record() else {
            try? session.setActive(false)
            throw RecordingError.failedToStart
        }
        self.recorder = recorder
        self.currentURL = file
        self.isRecording = true
        return file
    }

    public func stopRecording() async throws -> URL {
        guard let url = currentURL else { throw RecordingError.notRecording }
        recorder?.stop()
        recorder = nil
        currentURL = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
        return url
    }
}
```

```swift
// BrokerField/Transcription/SpeechTranscribing.swift
import Foundation

public enum TranscriptionError: Error, Equatable, Sendable {
    case authorizationDenied
    case localeUnavailable
    case onDeviceUnavailable
    case failed(String)
}

public protocol SpeechTranscribing: Sendable {
    func requestAuthorization() async -> Bool
    func transcribe(url: URL) async throws -> String
}

/// Test double — never touches the Speech framework.
public struct MockTranscriber: SpeechTranscribing {
    public var stubbedTranscript: String
    public var grantAuthorization: Bool

    public init(transcript: String, grantAuthorization: Bool = true) {
        self.stubbedTranscript = transcript
        self.grantAuthorization = grantAuthorization
    }

    public func requestAuthorization() async -> Bool { grantAuthorization }

    public func transcribe(url: URL) async throws -> String { stubbedTranscript }
}
```

```swift
// BrokerField/Transcription/SpeechTranscriber.swift
import Foundation
import Speech

/// On-device transcription, en-IN first (broker speech is often code-mixed;
/// the on-device en-IN model handles that better than en-US).
public struct SpeechTranscriber: SpeechTranscribing {
    public init() {}

    public func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    public func transcribe(url: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-IN")) else {
            throw TranscriptionError.localeUnavailable
        }
        guard recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            throw TranscriptionError.onDeviceUnavailable
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        return try await withCheckedThrowingContinuation { continuation in
            // Speech calls back multiple times (partial results, then final or
            // error) — resuming a continuation twice crashes, so guard it.
            let guardBox = ResumeGuard()
            recognizer.recognitionTask(with: request) { result, error in
                guardBox.resumeOnce {
                    if let error {
                        continuation.resume(throwing: TranscriptionError.failed(error.localizedDescription))
                        return true
                    }
                    guard let result, result.isFinal else { return false }
                    continuation.resume(returning: result.bestTranscription.formattedString)
                    return true
                }
            }
        }
    }
}

/// Runs `body` until it reports a terminal resume; later callbacks are dropped.
private final class ResumeGuard: @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false

    /// `body` returns true when it resumed the continuation.
    func resumeOnce(_ body: () -> Bool) {
        lock.lock()
        defer { lock.unlock() }
        guard !resumed else { return }
        if body() { resumed = true }
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add recording and on-device transcription services with mocks."
```

---

### Task 7: RecordingSession orchestrator

**Files:**
- Create: `broker-field-ios/BrokerField/Session/RecordingSession.swift`
- Test: `broker-field-ios/BrokerFieldTests/RecordingSessionTests.swift`

**Interfaces:**
- Consumes: `AudioRecording`/`MockRecorder`, `SpeechTranscribing`/`MockTranscriber` (Task 6); `EnquiryExtracting`/`MockExtractor` (Task 5); `EnquiryMapper`, `EnquiryDraft`, `TranscriptTrimmer` (Task 4); `Enquiry` (Task 3); `Outbox` (Task 9 — see note in Step 1).
- Produces: `RecordingSession` (@MainActor @Observable) with `state`, `transcript`, `wasTruncated`, `extractorAvailable`, `startRecording()`, `stopAndProcess()`, `submit(draft:)`, `reset()`. Consumed by Task 10 UI.

**Ordering note:** `RecordingSession.submit` calls `Outbox.processPending()`. Implement Task 9's `Outbox` before this task's Step 3, or temporarily inject a stub. The plan order below assumes **Task 9 (Outbox) is implemented before Task 7's implementation step** — swap them when executing.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/RecordingSessionTests.swift
import XCTest
import SwiftData
@testable import BrokerField

@MainActor
final class RecordingSessionTests: XCTestCase {
    private let transcript = "Asha Rao, 98765 43210, needs a 15-seat office in Koramangala."

    private func makeSession(
        recorder: MockRecorder = MockRecorder(),
        extractorResult: Result<EnquiryExtraction, Error>? = nil,
        extractorAvailability: ExtractorAvailability = .available,
        submitterResult: Result<LeadSubmissionResult, Error> = .success(LeadSubmissionResult(enquiryId: "srv-1", tier: "hot"))
    ) throws -> (RecordingSession, ModelContainer) {
        let container = try ModelContainer(for: Enquiry.self,
                                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let extraction = EnquiryExtraction(contactName: "Asha Rao", phone: "98765 43210",
                                           need: "office", budget: nil,
                                           localities: ["Koramangala"], timeline: nil,
                                           brief: "Asha Rao needs a 15-seat office in Koramangala.")
        let extractor = MockExtractor(availability: extractorAvailability,
                                      result: extractorResult ?? .success(extraction))
        let outbox = Outbox(container: container, submitter: MockSubmitter(result: submitterResult))
        let session = RecordingSession(recorder: recorder,
                                       transcriber: MockTranscriber(transcript: transcript),
                                       extractor: extractor,
                                       outbox: outbox,
                                       container: container)
        return (session, container)
    }

    func testMicPermissionDeniedFailsWithCopy() async throws {
        let (session, _) = try makeSession(recorder: MockRecorder(grantPermission: false))
        await session.startRecording()
        guard case .failed(let message) = session.state else {
            return XCTFail("expected failed, got \(session.state)")
        }
        XCTAssertTrue(message.contains("Microphone"))
    }

    func testStopAndProcessProducesMappedDraft() async throws {
        let (session, _) = try makeSession()
        await session.startRecording()
        XCTAssertEqual(session.state, .recording)
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            return XCTFail("expected ready, got \(session.state)")
        }
        XCTAssertEqual(draft.name, "Asha Rao")
        XCTAssertEqual(draft.need, .office)
        XCTAssertEqual(draft.step2Answers["preferredArea"], "Koramangala")
        XCTAssertEqual(session.transcript, transcript)
    }

    func testExtractorUnavailableFallsBackToManualDraft() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            return XCTFail("expected ready, got \(session.state)")
        }
        XCTAssertEqual(draft.brief, transcript)
        XCTAssertNil(draft.need)
    }

    func testGuardrailViolationFallsBackToManualDraft() async throws {
        let (session, _) = try makeSession(extractorResult: .failure(ExtractionError.guardrailViolation))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            return XCTFail("expected ready, got \(session.state)")
        }
        XCTAssertEqual(draft.brief, transcript)
    }

    func testSubmitWithoutNeedFails() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        await session.submit(draft: EnquiryDraft(name: "Asha Rao", phone: "9876543210"))
        guard case .failed(let message) = session.state else {
            return XCTFail("expected failed, got \(session.state)")
        }
        XCTAssertTrue(message.contains("Office"))
    }

    func testSubmitPersistsLocallyThenSubmits() async throws {
        let (session, container) = try makeSession()
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            return XCTFail("expected ready, got \(session.state)")
        }
        await session.submit(draft: draft)
        guard case .submitted(let tier) = session.state else {
            return XCTFail("expected submitted, got \(session.state)")
        }
        XCTAssertEqual(tier, "hot")
        let stored = try ModelContext(container).fetch(FetchDescriptor<Enquiry>())
        XCTAssertEqual(stored.count, 1)
        XCTAssertEqual(stored[0].status, .submitted)
        XCTAssertEqual(stored[0].serverEnquiryId, "srv-1")
        XCTAssertEqual(stored[0].phone, "+919876543210")
    }

    func testSubmitOfflineQueues() async throws {
        let (session, container) = try makeSession(
            submitterResult: .failure(SubmitError.server(500)))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            return XCTFail("expected ready, got \(session.state)")
        }
        await session.submit(draft: draft)
        XCTAssertEqual(session.state, .queuedOffline)
        let stored = try ModelContext(container).fetch(FetchDescriptor<Enquiry>())
        XCTAssertEqual(stored[0].status, .queued)
        XCTAssertEqual(stored[0].attemptCount, 1)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/RecordingSessionTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'RecordingSession' in scope` (and `Outbox`/`MockSubmitter` if Tasks 8–9 not yet done — do them first per the ordering note).

- [ ] **Step 3: Implement**

```swift
// BrokerField/Session/RecordingSession.swift
import Foundation
import SwiftData

@MainActor
@Observable
public final class RecordingSession {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        case transcribing
        case ready(EnquiryDraft)
        case submitting
        case submitted(tier: String?)
        case queuedOffline
        case failed(String)
    }

    public private(set) var state: State = .idle
    public private(set) var transcript: String = ""
    public private(set) var audioFileName: String?
    public private(set) var wasTruncated = false
    public let extractorAvailable: Bool

    private let recorder: any AudioRecording
    private let transcriber: any SpeechTranscribing
    private let extractor: any EnquiryExtracting
    private let outbox: Outbox
    private let context: ModelContext

    public init(recorder: any AudioRecording, transcriber: any SpeechTranscribing,
                extractor: any EnquiryExtracting, outbox: Outbox, container: ModelContainer) {
        self.recorder = recorder
        self.transcriber = transcriber
        self.extractor = extractor
        self.outbox = outbox
        self.context = ModelContext(container)
        self.extractorAvailable = extractor.availability() == .available
    }

    public func startRecording() async {
        guard await recorder.requestPermission() else {
            state = .failed("Microphone access is off. Enable it in Settings to record.")
            return
        }
        do {
            let url = try await recorder.startRecording()
            audioFileName = url.lastPathComponent
            state = .recording
        } catch {
            state = .failed("Couldn't start recording. Try again.")
        }
    }

    public func stopAndProcess() async {
        do {
            let url = try await recorder.stopRecording()
            audioFileName = url.lastPathComponent
            state = .transcribing
            guard await transcriber.requestAuthorization() else {
                transcript = ""
                state = .ready(EnquiryDraft())
                return
            }
            let raw = try await transcriber.transcribe(url: url)
            let trimmed = TranscriptTrimmer.truncate(raw)
            transcript = trimmed.text
            wasTruncated = trimmed.wasTruncated
            if extractorAvailable {
                let extraction = try await extractor.extract(from: trimmed.text)
                state = .ready(EnquiryMapper.draft(from: extraction))
            } else {
                state = .ready(EnquiryDraft(brief: trimmed.text))
            }
        } catch ExtractionError.guardrailViolation, ExtractionError.contextOverflow {
            // Model refused or overflowed — the transcript is still usable.
            state = .ready(EnquiryDraft(brief: transcript))
        } catch {
            state = .failed("Couldn't process the note. You can still type it manually.")
        }
    }

    /// Local-first, always: the enquiry is persisted before any network call —
    /// the client mirror of the backend's "Postgres first" rule.
    public func submit(draft: EnquiryDraft) async {
        guard let need = draft.need else {
            state = .failed("Pick Office, Retail, or Lease before submitting.")
            return
        }
        let normalized = PhoneNormalizer.normalize(draft.phone)
        guard !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              PhoneNormalizer.isValid(normalized) else {
            state = .failed("Name and a valid phone number are required.")
            return
        }
        let enquiry = Enquiry(audioFileName: audioFileName, transcript: transcript,
                              name: draft.name, phone: normalized, need: need,
                              brief: draft.brief, step2Answers: draft.step2Answers)
        enquiry.status = .queued
        enquiry.nextAttemptAt = .now
        context.insert(enquiry)
        try? context.save()

        state = .submitting
        await outbox.processPending()
        switch enquiry.status {
        case .submitted:
            state = .submitted(tier: enquiry.serverTier)
        case .failed:
            state = .failed(enquiry.lastError ?? "Submission failed.")
        default:
            state = .queuedOffline
        }
    }

    public func reset() {
        state = .idle
        transcript = ""
        audioFileName = nil
        wasTruncated = false
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add RecordingSession orchestrator (record → transcribe → extract → submit)."
```

---

### Task 8: Lead submitter (POST /api/leads)

**Files:**
- Create: `broker-field-ios/BrokerField/Sync/APIConfig.swift`
- Create: `broker-field-ios/BrokerField/Sync/LeadSubmitting.swift`
- Create: `broker-field-ios/BrokerField/Sync/LeadSubmitter.swift`
- Test: `broker-field-ios/BrokerFieldTests/StubURLProtocol.swift`
- Test: `broker-field-ios/BrokerFieldTests/LeadSubmitterTests.swift`

**Interfaces:**
- Consumes: `LeadPayload` (Task 2).
- Produces: `LeadSubmitting` protocol, `LeadSubmissionResult(enquiryId:tier:)`, `SubmitError`, `MockSubmitter`, `LeadSubmitter`, `APIConfig.baseURL`. Consumed by Tasks 7, 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/StubURLProtocol.swift
import Foundation

/// Intercepts every request made with a session configured to use it.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = StubURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
}
```

```swift
// BrokerFieldTests/LeadSubmitterTests.swift
import XCTest
@testable import BrokerField

final class LeadSubmitterTests: XCTestCase {
    private let baseURL = URL(string: "http://test.local")!
    private let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                      brief: "15 seats", step2Answers: ["preferredArea": "Koramangala"])

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testSuccessDecodesTierAndId() async throws {
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/leads")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "content-type"), "application/json")
            let body = try JSONDecoder().decode(LeadPayload.self, from: request.httpBodyData!)
            XCTAssertEqual(body, self.payload)
            let json = #"{"ok":true,"crm":"pending","tier":"hot","enquiryId":"srv-1"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, json)
        }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        let result = try await submitter.submit(payload)
        XCTAssertEqual(result, LeadSubmissionResult(enquiryId: "srv-1", tier: "hot"))
    }

    func testClientErrorCarriesServerMessage() async {
        StubURLProtocol.handler = { request in
            let json = #"{"error":"invalid body"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil)!, json)
        }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await XCTAssertThrowsErrorAsync(await submitter.submit(payload)) { error in
            XCTAssertEqual(error as? SubmitError, .client("invalid body"))
        }
    }

    func testServerErrorCarriesStatus() async {
        StubURLProtocol.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data())
        }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await XCTAssertThrowsErrorAsync(await submitter.submit(payload)) { error in
            XCTAssertEqual(error as? SubmitError, .server(500))
        }
    }
}
```

Note: `request.httpBodyData` — add this small extension at the bottom of `StubURLProtocol.swift` (httpBody is nil for streamed bodies in URLProtocol):

```swift
private extension URLRequest {
    var httpBodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: 4096)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/LeadSubmitterTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'LeadSubmitter' in scope`.

- [ ] **Step 3: Implement**

```swift
// BrokerField/Sync/APIConfig.swift
import Foundation

public enum APIConfig {
    /// Dogfood default: the GCP VM serving the listings app (verified reachable
    /// 2026-09-18 — POST /api/leads answers 400 on an empty body). Flip to the
    /// HTTPS domain once apex DNS points back at the app, then remove the ATS
    /// exception from Info.plist.
    public static let defaultBaseURL = URL(string: "http://34.47.192.145")!

    public static var baseURL: URL {
        if let override = Bundle.main.object(forInfoDictionaryKey: "GSAPIBaseURL") as? String,
           !override.isEmpty, let url = URL(string: override) {
            return url
        }
        return defaultBaseURL
    }
}
```

```swift
// BrokerField/Sync/LeadSubmitting.swift
import Foundation

public struct LeadSubmissionResult: Equatable, Sendable {
    public let enquiryId: String?
    public let tier: String?

    public init(enquiryId: String?, tier: String?) {
        self.enquiryId = enquiryId
        self.tier = tier
    }
}

public enum SubmitError: Error, Equatable, Sendable {
    case transport
    case client(String)
    case server(Int)
}

public protocol LeadSubmitting: Sendable {
    func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult
}

/// Test double.
public struct MockSubmitter: LeadSubmitting {
    public var result: Result<LeadSubmissionResult, Error>
    public private(set) var submittedPayloads: [LeadPayload] = []

    public init(result: Result<LeadSubmissionResult, Error>) {
        self.result = result
    }

    public func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult {
        try result.get()
    }
}
```

```swift
// BrokerField/Sync/LeadSubmitter.swift
import Foundation

public struct LeadSubmitter: LeadSubmitting {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL = APIConfig.baseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult {
        var request = URLRequest(url: baseURL.appending(path: "/api/leads"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SubmitError.transport }
        switch http.statusCode {
        case 200..<300:
            let decoded = try JSONDecoder().decode(LeadResponse.self, from: data)
            return LeadSubmissionResult(enquiryId: decoded.enquiryId, tier: decoded.tier)
        case 400, 422:
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
                ?? "invalid submission"
            throw SubmitError.client(message)
        default:
            throw SubmitError.server(http.statusCode)
        }
    }
}

private struct LeadResponse: Decodable {
    let ok: Bool?
    let tier: String?
    let enquiryId: String?
}

private struct ErrorResponse: Decodable {
    let error: String
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add LeadSubmitter for POST /api/leads with stubbed-session tests."
```

---

### Task 9: Outbox + backoff

**Files:**
- Create: `broker-field-ios/BrokerField/Sync/Outbox.swift`
- Test: `broker-field-ios/BrokerFieldTests/OutboxTests.swift`

**Interfaces:**
- Consumes: `Enquiry` (Task 3), `LeadSubmitting`/`MockSubmitter` (Task 8).
- Produces: `Outbox` actor (`processPending(now:)`), `BackoffPolicy.nextAttemptDate(after:from:)`. Consumed by Tasks 7, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/OutboxTests.swift
import XCTest
import SwiftData
@testable import BrokerField

final class OutboxTests: XCTestCase {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    private func seedQueued(_ context: ModelContext, attemptCount: Int = 0,
                            nextAttemptAt: Date? = nil) -> Enquiry {
        let enquiry = Enquiry(name: "Asha Rao", phone: "9876543210", need: .office, brief: "b")
        enquiry.status = .queued
        enquiry.attemptCount = attemptCount
        enquiry.nextAttemptAt = nextAttemptAt
        context.insert(enquiry)
        try! context.save()
        return enquiry
    }

    func testBackoffSchedule() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(BackoffPolicy.nextAttemptDate(after: 0, from: now), now)
        XCTAssertEqual(BackoffPolicy.nextAttemptDate(after: 1, from: now), now.addingTimeInterval(30))
        XCTAssertEqual(BackoffPolicy.nextAttemptDate(after: 2, from: now), now.addingTimeInterval(120))
        XCTAssertEqual(BackoffPolicy.nextAttemptDate(after: 4, from: now), now.addingTimeInterval(1800))
        XCTAssertNil(BackoffPolicy.nextAttemptDate(after: 5, from: now))
    }

    @MainActor
    func testSuccessfulSubmitMarksSubmitted() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let enquiry = seedQueued(context)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: "srv-1", tier: "warm"))))
        await outbox.processPending()
        XCTAssertEqual(enquiry.status, .submitted)
        XCTAssertEqual(enquiry.serverEnquiryId, "srv-1")
        XCTAssertEqual(enquiry.serverTier, "warm")
        XCTAssertNil(enquiry.lastError)
    }

    @MainActor
    func testFailureSchedulesNextAttempt() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let now = Date()
        let enquiry = seedQueued(context, nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.server(500))))
        await outbox.processPending(now: now)
        XCTAssertEqual(enquiry.status, .queued)
        XCTAssertEqual(enquiry.attemptCount, 1)
        XCTAssertEqual(enquiry.nextAttemptAt, now.addingTimeInterval(30))
        XCTAssertNotNil(enquiry.lastError)
    }

    @MainActor
    func testFutureAttemptIsSkipped() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let enquiry = seedQueued(context, nextAttemptAt: Date().addingTimeInterval(3600))
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        XCTAssertEqual(enquiry.status, .queued)
        XCTAssertEqual(enquiry.attemptCount, 0)
    }

    @MainActor
    func testMaxAttemptsMarksFailed() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let now = Date()
        let enquiry = seedQueued(context, attemptCount: 4, nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.transport)))
        await outbox.processPending(now: now)
        XCTAssertEqual(enquiry.status, .failed)
        XCTAssertEqual(enquiry.attemptCount, 5)
        XCTAssertNil(enquiry.nextAttemptAt)
    }

    @MainActor
    func testIncompleteEnquiryFailsWithoutNetwork() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let enquiry = Enquiry(name: "", phone: "", need: nil, brief: "b")
        enquiry.status = .queued
        context.insert(enquiry)
        try! context.save()
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        XCTAssertEqual(enquiry.status, .failed)
        XCTAssertEqual(enquiry.lastError, "incomplete enquiry")
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/OutboxTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'Outbox' in scope`.

- [ ] **Step 3: Implement**

```swift
// BrokerField/Sync/Outbox.swift
import Foundation
import SwiftData

public enum BackoffPolicy {
    /// Delays before attempts 1…5: immediate, 30s, 2m, 10m, 30m.
    public static let delays: [TimeInterval] = [0, 30, 120, 600, 1800]
    public static let maxAttempts = 5

    public static func nextAttemptDate(after attemptCount: Int, from now: Date) -> Date? {
        guard attemptCount < delays.count else { return nil }
        return now.addingTimeInterval(delays[attemptCount])
    }
}

/// Retries queued enquiries. Only `queued` rows are processed — `failed` rows
/// need a manual retry from the detail view (which re-queues them).
public actor Outbox {
    private let container: ModelContainer
    private let submitter: any LeadSubmitting

    public init(container: ModelContainer, submitter: any LeadSubmitting) {
        self.container = container
        self.submitter = submitter
    }

    public func processPending(now: Date = .now) async {
        let context = ModelContext(container)
        let queuedRaw = EnquiryStatus.queued.rawValue
        let descriptor = FetchDescriptor<Enquiry>(
            predicate: #Predicate { $0.statusRaw == queuedRaw })
        guard let pending = try? context.fetch(descriptor) else { return }

        for enquiry in pending where (enquiry.nextAttemptAt ?? .distantPast) <= now {
            guard let payload = enquiry.makePayload() else {
                enquiry.status = .failed
                enquiry.lastError = "incomplete enquiry"
                enquiry.nextAttemptAt = nil
                continue
            }
            do {
                let result = try await submitter.submit(payload)
                enquiry.status = .submitted
                enquiry.serverEnquiryId = result.enquiryId
                enquiry.serverTier = result.tier
                enquiry.lastError = nil
                enquiry.nextAttemptAt = nil
            } catch {
                enquiry.attemptCount += 1
                enquiry.lastError = String(describing: error)
                if let next = BackoffPolicy.nextAttemptDate(after: enquiry.attemptCount, from: now) {
                    enquiry.nextAttemptAt = next
                } else {
                    enquiry.status = .failed
                    enquiry.nextAttemptAt = nil
                }
            }
        }
        try? context.save()
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add SwiftData-backed outbox with backoff retry."
```

---

### Task 10: UI + app wiring + UI test

**Files:**
- Create: `broker-field-ios/BrokerField/Theme.swift`
- Create: `broker-field-ios/BrokerField/AppEnvironment.swift`
- Create: `broker-field-ios/BrokerField/UI/RecordView.swift`
- Create: `broker-field-ios/BrokerField/UI/ReviewSheet.swift`
- Create: `broker-field-ios/BrokerField/UI/HistoryView.swift`
- Create: `broker-field-ios/BrokerField/UI/EnquiryDetailView.swift`
- Create: `broker-field-ios/BrokerField/UI/RootView.swift`
- Modify: `broker-field-ios/BrokerField/BrokerFieldApp.swift`
- Modify: `broker-field-ios/BrokerFieldUITests/BrokerFieldUITests.swift`

**Interfaces:**
- Consumes: everything above.
- Produces: the runnable app. `AppEnvironment.make()` selects `.uiTesting` when launched with `-UITesting`.

- [ ] **Step 1: Write the failing UI test** (replaces the placeholder)

```swift
// BrokerFieldUITests/BrokerFieldUITests.swift
import XCTest

final class BrokerFieldUITests: XCTestCase {
    @MainActor
    func testRecordReviewSubmitHappyPath() {
        let app = XCUIApplication()
        app.launchArguments = ["-UITesting"]
        app.launch()

        app.buttons["recordButton"].tap()
        app.buttons["stopButton"].tap()

        let nameField = app.textFields["nameField"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 15))
        XCTAssertEqual(nameField.value as? String, "Asha Rao")

        app.buttons["submitButton"].tap()
        XCTAssertTrue(app.staticTexts["submittedLabel"].waitForExistence(timeout: 15))
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldUITests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — no `recordButton` exists yet.

- [ ] **Step 3: Implement the UI**

```swift
// BrokerField/Theme.swift
import SwiftUI

public extension Color {
    /// Gentle Space accent — same value as the web v3 token `--accent: #6840B8`.
    static let gsAccent = Color(red: 0x68 / 255, green: 0x40 / 255, blue: 0xB8 / 255)
}
```

```swift
// BrokerField/AppEnvironment.swift
import Foundation
import SwiftData

/// Service graph. `-UITesting` swaps in mocks and an in-memory store so UI
/// tests never touch the mic, Speech, AFM, or the network.
public struct AppEnvironment {
    public let container: ModelContainer
    public let recorder: any AudioRecording
    public let transcriber: any SpeechTranscribing
    public let extractor: any EnquiryExtracting
    public let submitter: any LeadSubmitting

    public static func make() -> AppEnvironment {
        if ProcessInfo.processInfo.arguments.contains("-UITesting") { return uiTesting }
        return production
    }

    // try! is deliberate: a corrupt local store is unrecoverable at launch and
    // crashing loudly beats silently losing field notes.
    public static let production = AppEnvironment(
        container: try! ModelContainer(for: Enquiry.self),
        recorder: AudioRecorder(),
        transcriber: SpeechTranscriber(),
        extractor: FoundationModelsExtractor(),
        submitter: LeadSubmitter())

    public static let uiTesting = AppEnvironment(
        container: try! ModelContainer(
            for: Enquiry.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)),
        recorder: MockRecorder(),
        transcriber: MockTranscriber(
            transcript: "Asha Rao, 98765 43210, needs a 15-seat office in Koramangala, move in next month."),
        extractor: MockExtractor(result: .success(EnquiryExtraction(
            contactName: "Asha Rao", phone: "98765 43210", need: "office", budget: nil,
            localities: ["Koramangala"], timeline: "next month",
            brief: "Asha Rao needs a 15-seat office in Koramangala. Wants to move in next month."))),
        submitter: MockSubmitter(result: .success(
            LeadSubmissionResult(enquiryId: "ui-test-enquiry", tier: "hot"))))
}
```

```swift
// BrokerField/UI/RecordView.swift
import SwiftUI

public struct RecordView: View {
    @State var session: RecordingSession
    @State private var showingReview = false

    public init(session: RecordingSession) {
        _session = State(initialValue: session)
    }

    public var body: some View {
        VStack(spacing: 32) {
            Spacer()
            statusText
            recordControl
            Spacer()
            if !session.extractorAvailable {
                Label("On-device AI is unavailable — you can still type the enquiry after recording.",
                      systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
        }
        .padding()
        .navigationTitle("New enquiry")
        .onChange(of: session.state) { _, newState in
            if case .ready = newState { showingReview = true }
        }
        .sheet(isPresented: $showingReview, onDismiss: { session.reset() }) {
            if case .ready(let draft) = session.state {
                NavigationStack {
                    ReviewSheet(draft: draft, transcript: session.transcript,
                                wasTruncated: session.wasTruncated, session: session)
                }
            }
        }
    }

    @ViewBuilder
    private var statusText: some View {
        switch session.state {
        case .idle:
            Text("Tap to record after a client call or site visit.")
                .foregroundStyle(.secondary)
        case .recording:
            Label("Recording…", systemImage: "waveform")
                .foregroundStyle(Color.gsAccent)
        case .transcribing:
            Label("Transcribing on-device…", systemImage: "text.bubble")
                .foregroundStyle(.secondary)
        case .submitting:
            Label("Submitting…", systemImage: "arrow.up.circle")
                .foregroundStyle(.secondary)
        case .failed(let message):
            Text(message)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
        default:
            Text(" ")
        }
    }

    @ViewBuilder
    private var recordControl: some View {
        switch session.state {
        case .recording:
            Button { Task { await session.stopAndProcess() } } label: {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 88))
                    .foregroundStyle(.red)
            }
            .accessibilityIdentifier("stopButton")
        case .idle, .failed:
            Button { Task { await session.startRecording() } } label: {
                Image(systemName: "mic.circle.fill")
                    .font(.system(size: 88))
                    .foregroundStyle(Color.gsAccent)
            }
            .accessibilityIdentifier("recordButton")
        default:
            ProgressView()
        }
    }
}
```

```swift
// BrokerField/UI/ReviewSheet.swift
import SwiftUI

public struct ReviewSheet: View {
    @State var draft: EnquiryDraft
    let transcript: String
    let wasTruncated: Bool
    let session: RecordingSession

    public init(draft: EnquiryDraft, transcript: String, wasTruncated: Bool, session: RecordingSession) {
        _draft = State(initialValue: draft)
        self.transcript = transcript
        self.wasTruncated = wasTruncated
        self.session = session
    }

    public var body: some View {
        Form {
            if case .submitted(let tier) = session.state {
                Section {
                    Label("Submitted — qualification tier: \(tier ?? "standard")", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.gsAccent)
                        .accessibilityIdentifier("submittedLabel")
                }
            } else if case .queuedOffline = session.state {
                Section {
                    Label("Saved offline — will submit when the network is back.", systemImage: "tray.and.arrow.up")
                        .accessibilityIdentifier("queuedLabel")
                }
            } else {
                contactSection
                needSection
                briefSection
                transcriptSection
                submitSection
            }
        }
        .navigationTitle("Review enquiry")
    }

    private var contactSection: some View {
        Section("Contact") {
            TextField("Name", text: $draft.name)
                .accessibilityIdentifier("nameField")
            TextField("Phone", text: $draft.phone)
                .keyboardType(.phonePad)
                .accessibilityIdentifier("phoneField")
        }
    }

    private var needSection: some View {
        Section("Need") {
            Picker("Need type", selection: $draft.need) {
                Text("Choose…").tag(NeedType?.none)
                Text("Office space").tag(NeedType?.some(.office))
                Text("Retail space").tag(NeedType?.some(.retail))
                Text("Lease out my property").tag(NeedType?.some(.lease))
            }
            .accessibilityIdentifier("needPicker")
            if let need = draft.need {
                ForEach(Step2Schema.fields(for: need), id: \.key) { field in
                    if field.isChoice {
                        Picker(field.label, selection: choiceBinding(for: field.key)) {
                            Text("Choose…").tag("")
                            ForEach(Step2Schema.timelineBuckets, id: \.self) { bucket in
                                Text(bucket).tag(bucket)
                            }
                        }
                    } else {
                        TextField(field.label, text: textBinding(for: field.key))
                    }
                }
            }
        }
    }

    private var briefSection: some View {
        Section("Brief") {
            TextEditor(text: $draft.brief)
                .frame(minHeight: 80)
                .accessibilityIdentifier("briefEditor")
        }
    }

    @ViewBuilder
    private var transcriptSection: some View {
        if !transcript.isEmpty {
            Section("Transcript") {
                if wasTruncated {
                    Text("Long note — only the first part was analysed.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text(transcript)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var submitSection: some View {
        Section {
            Button {
                Task { await session.submit(draft: draft) }
            } label: {
                Text("Submit enquiry")
                    .frame(maxWidth: .infinity)
                    .fontWeight(.semibold)
            }
            .tint(.gsAccent)
            .accessibilityIdentifier("submitButton")
        }
    }

    private func textBinding(for key: String) -> Binding<String> {
        Binding(
            get: { draft.step2Answers[key] ?? "" },
            set: { draft.step2Answers[key] = $0 })
    }

    private func choiceBinding(for key: String) -> Binding<String> {
        textBinding(for: key)
    }
}
```

```swift
// BrokerField/UI/HistoryView.swift
import SwiftData
import SwiftUI

public struct HistoryView: View {
    @Query(sort: \Enquiry.createdAt, order: .reverse) private var enquiries: [Enquiry]

    public init() {}

    public var body: some View {
        NavigationStack {
            List(enquiries) { enquiry in
                NavigationLink(destination: EnquiryDetailView(enquiry: enquiry)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(enquiry.name.isEmpty ? "Unnamed enquiry" : enquiry.name)
                            .fontWeight(.medium)
                        Text(enquiry.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    statusBadge(enquiry.status)
                }
            }
            .navigationTitle("Enquiries")
            .overlay {
                if enquiries.isEmpty {
                    ContentUnavailableView("No enquiries yet",
                                           systemImage: "mic.badge.plus",
                                           description: Text("Record your first voice note."))
                }
            }
        }
    }

    private func statusBadge(_ status: EnquiryStatus) -> some View {
        let (text, color): (String, Color) = {
            switch status {
            case .submitted: return ("Submitted", .gsAccent)
            case .queued: return ("Queued", .orange)
            case .failed: return ("Failed", .red)
            case .draft: return ("Draft", .secondary)
            }
        }()
        return Text(text)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
```

```swift
// BrokerField/UI/EnquiryDetailView.swift
import SwiftData
import SwiftUI

public struct EnquiryDetailView: View {
    @Environment(\.modelContext) private var context
    let enquiry: Enquiry

    public init(enquiry: Enquiry) {
        self.enquiry = enquiry
    }

    public var body: some View {
        Form {
            Section("Contact") {
                LabeledContent("Name", value: enquiry.name)
                LabeledContent("Phone", value: enquiry.phone)
                if let need = enquiry.need {
                    LabeledContent("Need", value: need.rawValue.capitalized)
                }
            }
            if !enquiry.step2Answers.isEmpty {
                Section("Details") {
                    ForEach(enquiry.step2Answers.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        LabeledContent(key, value: value)
                    }
                }
            }
            Section("Brief") {
                Text(enquiry.brief)
            }
            if !enquiry.transcript.isEmpty {
                Section("Transcript") {
                    Text(enquiry.transcript)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if let tier = enquiry.serverTier {
                Section("Result") {
                    LabeledContent("Tier", value: tier)
                    if let id = enquiry.serverEnquiryId {
                        LabeledContent("Server id", value: id)
                    }
                }
            }
            if enquiry.status == .failed {
                Section {
                    if let error = enquiry.lastError {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Button("Retry submission") {
                        enquiry.status = .queued
                        enquiry.attemptCount = 0
                        enquiry.nextAttemptAt = .now
                        try? context.save()
                    }
                    .accessibilityIdentifier("retryButton")
                }
            }
        }
        .navigationTitle("Enquiry")
    }
}
```

```swift
// BrokerField/UI/RootView.swift
import SwiftUI

public struct RootView: View {
    let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        TabView {
            Tab("Record", systemImage: "mic.fill") {
                NavigationStack {
                    RecordView(session: RecordingSession(
                        recorder: environment.recorder,
                        transcriber: environment.transcriber,
                        extractor: environment.extractor,
                        outbox: Outbox(container: environment.container,
                                       submitter: environment.submitter),
                        container: environment.container))
                }
            }
            Tab("History", systemImage: "list.bullet") {
                HistoryView()
            }
        }
        .tint(.gsAccent)
    }
}
```

```swift
// BrokerField/BrokerFieldApp.swift
import SwiftData
import SwiftUI

@main
struct BrokerFieldApp: App {
    let environment = AppEnvironment.make()

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .task {
                    // Flush any queued enquiries from a previous offline session.
                    await Outbox(container: environment.container,
                                 submitter: environment.submitter).processPending()
                }
        }
        .modelContainer(environment.container)
    }
}
```

- [ ] **Step 4: Run the UI test to verify pass**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldUITests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: `** TEST SUCCEEDED **` — `testRecordReviewSubmitHappyPath` passed.

- [ ] **Step 5: Run the whole suite**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -8
```

Expected: `** TEST SUCCEEDED **` — all unit + UI tests green.

- [ ] **Step 6: Commit**

```bash
git add broker-field-ios && git commit -m "Add record/review/history UI, app wiring, and happy-path UI test."
```

---

### Task 11: Final gate + README

**Files:**
- Create: `broker-field-ios/README.md`

- [ ] **Step 1: Full clean test run**

```bash
cd /Users/swami/Documents/GentleSpace_Web/broker-field-ios
rm -rf ~/Library/Developer/Xcode/DerivedData/BrokerField-*
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -8
```

Expected: `** TEST SUCCEEDED **`, 0 failures across `BrokerFieldTests` and `BrokerFieldUITests`.

- [ ] **Step 2: Write `README.md`**

```markdown
# Broker Field (iOS)

On-device voice-note → structured enquiry capture for Gentle Space brokers.
Spec: `../docs/superpowers/specs/2026-09-18-broker-field-ios-design.md`.

## Requirements
- Xcode 26+ (26.2 verified), iOS 26 simulator or device.
- On-device AI extraction needs an Apple Intelligence iPhone (15 Pro+).
  Without it the app still records, transcribes, and submits manually.

## Run
Open `BrokerField.xcodeproj`, pick the `BrokerField` scheme, run.
Backend base URL: `GSAPIBaseURL` in `Info.plist` (default: dogfood VM).

## Test
```
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO
```

## Device checklist (manual gate)
- [ ] Apple Intelligence enabled; mic + speech permissions granted
- [ ] Record 30s code-mixed (English/Hindi) note → transcript sensible
- [ ] Extraction fills name/phone/need/localities; review edits work
- [ ] Airplane-mode submit → queued; disable airplane → outbox submits
- [ ] Enquiry visible in the ads-agent pipeline (via /api/leads → S5a)
```

- [ ] **Step 3: Commit**

```bash
git add broker-field-ios/README.md && git commit -m "Add Broker Field README with run/test/device checklist."
```

---

## Self-Review Notes (ran 2026-09-18)

- **Spec coverage:** record (T6), transcribe (T6), extract + seam + degradation (T4/T5), review + submit (T7/T10), local-first + outbox (T3/T9), history + retry (T10), schema mapping (T2/T4), availability states (T5/T7/T10), testing incl. UI + device gate (T10/T11). Milestones M2–M4 are spec-only by design.
- **Ordering:** Tasks 8 and 9 must be implemented **before** Task 7's implementation step (RecordingSession depends on `Outbox`, `MockSubmitter`, `SubmitError`). Task 7's tests reference all three.
- **Known sharp edges flagged inline:** Speech continuation double-resume guard (T6), `httpBodyStream` in URLProtocol stubs (T8), en-dash characters in `TIMELINE_BUCKETS` (T2 uses `\u{2013}` escapes), simulator cannot validate AFM quality (device checklist in T11).
