# Broker Field iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M1 slice of Broker Field — an iPhone app that records a broker's voice note, transcribes and extracts a structured enquiry on-device (SpeechAnalyzer + Apple Foundation Models), and submits it to the existing `POST /api/leads` pipeline.

**Architecture:** Thin SwiftUI app over protocol-seamed services (`AudioRecording`, `SpeechTranscribing`, `EnquiryExtracting`, `LeadSubmitting`) so every stage is mockable and testable in the simulator. Local-first persistence via SwiftData before any network call; an outbox actor retries submissions with backoff. Spec: `docs/superpowers/specs/2026-09-18-broker-field-ios-design.md`.

**Tech Stack:** Swift 6, SwiftUI, SwiftData, FoundationModels (iOS 26), Speech framework's **SpeechAnalyzer/SpeechTranscriber** (iOS 26, on-device by design), AVFoundation, **Swift Testing** (unit) + XCTest/XCUI (UI only). Zero third-party dependencies. Xcode 26.2 at `/Applications/Xcode.app`.

> **Revision 2 (2026-09-18, post-audit).** Adversarial review + current-docs research drove these changes from rev 1: (1) transcription moved from legacy `SFSpeechRecognizer` to iOS 26 `SpeechAnalyzer`/`SpeechTranscriber` (on-device by design, no ~1-minute cap, AsyncSequence API, AssetInventory model download); (2) unit tests use Swift Testing (`@Test`/`#expect`) — the Xcode 26 default for new code — while UI tests stay on XCTest/XCUI (the only UI automation framework); (3) AFM error handling adds the `.refusal` case and session prewarming; (4) keyword need-inference uses word boundaries ("workshop" no longer matches "shop"); (5) UI test waits for buttons before tapping; (6) review sheet surfaces failure/notice banners; (7) outbox also flushes on foreground via `scenePhase`; (8) tasks renumbered so dependencies are strictly linear.

## Global Constraints

- Deployment target iOS 26.0, iPhone only (`TARGETED_DEVICE_FAMILY = 1`), Swift 6.0.
- All Swift/iOS work lives in `broker-field-ios/`; the Next.js apps are untouched. No backend changes.
- Bundle ids: `com.gentlespace.brokerfield` (app), `.tests` (unit), `.uitests` (UI).
- Backend base URL default `http://34.47.192.145` (verified live 2026-09-18: `POST /api/leads` with `{}` → 400). Overridable via `GSAPIBaseURL` in Info.plist. **Security note:** this is HTTP cleartext carrying names/phones — acceptable only for dogfood; moving to the HTTPS domain is a hard pre-production blocker (tracked in the spec's open questions).
- `NeedType` values must stay `"office" | "retail" | "lease"` and step-2 keys must mirror `lib/leads/step2-fields.ts` verbatim (office: `teamSize`/`preferredArea`/`moveInTimeline`; retail: `frontageFootfall`/`preferredLocality`/`timeline`; lease: `propertySize`/`location`/`expectedRentTimeline`).
- `TIMELINE_BUCKETS` verbatim: `Immediate (this month)`, `1–3 months` (en dash U+2013), `3–6 months` (en dash), `Just exploring`.
- Never crash on model/speech/mic unavailability — every state degrades to a manual path.
- Unit tests: Swift Testing. UI tests: XCTest/XCUI. All runs via `xcodebuild` with `CODE_SIGNING_ALLOWED=NO` (simulator). On-device AFM + SpeechAnalyzer validation is a manual gate at the end.
- Commit after every task. Work on branch `feat/broker-field-ios`.

## File Structure

```
broker-field-ios/
  .gitignore
  Info.plist
  BrokerField.xcodeproj/project.pbxproj   (3 targets, folder-synchronized — never edit per-file)
  BrokerField/
    BrokerFieldApp.swift                  entry point, AppEnvironment wiring, foreground outbox flush
    AppEnvironment.swift                  production vs -UITesting service graph
    Theme.swift                           gsAccent color (#6840B8)
    Model/NeedType.swift                  NeedType + Step2Field + Step2Schema
    Model/PhoneNormalizer.swift
    Model/LeadPayload.swift
    Model/Enquiry.swift                   SwiftData @Model + EnquiryStatus
    Model/EnquiryDraft.swift              EnquiryDraft + EnquiryMapper
    Extraction/EnquiryExtraction.swift    @Generable struct
    Extraction/TranscriptTrimmer.swift
    Extraction/EnquiryExtracting.swift    protocol + ExtractorAvailability + ExtractionError + MockExtractor
    Extraction/FoundationModelsExtractor.swift
    Recording/AudioRecording.swift        protocol + MockRecorder
    Recording/AudioRecorder.swift         actor over AVAudioRecorder
    Transcription/SpeechTranscribing.swift protocol + MockTranscriber
    Transcription/SpeechTranscriber.swift SpeechAnalyzer + SpeechTranscriber (file-based, offline preset)
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
  BrokerFieldTests/                       Swift Testing suites, one per unit above
  BrokerFieldUITests/                     XCTest/XCUI happy-path test via -UITesting harness
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

- [ ] **Step 6: Write `BrokerFieldTests/SanityTests.swift`** (Swift Testing)

```swift
import Testing
@testable import BrokerField

@Suite("Sanity")
struct SanityTests {
    @Test func harnessRuns() {
        #expect(1 + 1 == 2)
    }
}
```

- [ ] **Step 7: Write `BrokerFieldUITests/BrokerFieldUITests.swift`** (XCUI — the only UI automation framework)

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

Expected: `** TEST SUCCEEDED **`; `SanityTests.harnessRuns` passed; `BrokerFieldUITests.testAppLaunches` passed.

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
import Testing
@testable import BrokerField

@Suite("Step2 schema")
struct Step2SchemaTests {
    @Test func officeKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .office).map(\.key)
            == ["teamSize", "preferredArea", "moveInTimeline"])
    }

    @Test func retailKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .retail).map(\.key)
            == ["frontageFootfall", "preferredLocality", "timeline"])
    }

    @Test func leaseKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .lease).map(\.key)
            == ["propertySize", "location", "expectedRentTimeline"])
    }

    @Test func timelineBucketsMatchWebVerbatim() {
        #expect(Step2Schema.timelineBuckets
            == ["Immediate (this month)", "1\u{2013}3 months", "3\u{2013}6 months", "Just exploring"])
    }

    @Test func choiceFieldsAreFlagged() throws {
        let office = Step2Schema.fields(for: .office)
        #expect(try office.first { $0.key == "moveInTimeline" } #require .isChoice)
        #expect(try !office.first { $0.key == "teamSize" } #require .isChoice)
    }
}
```

```swift
// BrokerFieldTests/PhoneNormalizerTests.swift
import Testing
@testable import BrokerField

@Suite("Phone normalizer")
struct PhoneNormalizerTests {
    @Test(arguments: [
        ("98765 43210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("919876543210", "+919876543210"),
    ])
    func normalization(input: String, expected: String) {
        #expect(PhoneNormalizer.normalize(input) == expected)
    }

    @Test func validityWindow() {
        #expect(!PhoneNormalizer.isValid("123"))
        #expect(PhoneNormalizer.isValid("+919876543210"))
        #expect(!PhoneNormalizer.isValid(""))
    }
}
```

```swift
// BrokerFieldTests/LeadPayloadTests.swift
import Foundation
import Testing
@testable import BrokerField

@Suite("Lead payload")
struct LeadPayloadTests {
    @Test func encodesWebContractKeys() throws {
        let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                  brief: "15 seats in Koramangala",
                                  step2Answers: ["preferredArea": "Koramangala"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        #expect(json["name"] as? String == "Asha Rao")
        #expect(json["phone"] as? String == "+919876543210")
        #expect(json["need"] as? String == "office")
        #expect(json["brief"] as? String == "15 seats in Koramangala")
        #expect((json["step2Answers"] as? [String: String])?["preferredArea"] == "Koramangala")
        #expect(json["propertyName"] == nil)
    }

    @Test func omitsNilStep2Answers() throws {
        let payload = LeadPayload(name: "A", phone: "+919876543210", need: .retail, brief: "b")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        #expect(json["step2Answers"] == nil)
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

Expected: `** TEST SUCCEEDED **` — schema 5 + phone 2 (one parameterized) + payload 2 suites, 0 failures.

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
- Produces: `Enquiry` (@Model), `EnquiryStatus`, `Enquiry.makePayload()`, `enquiry.status` / `enquiry.need` / `enquiry.step2Answers` accessors. Consumed by Tasks 8, 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/EnquiryModelTests.swift
import Foundation
import SwiftData
import Testing
@testable import BrokerField

@Suite("Enquiry model")
struct EnquiryModelTests {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    @Test func persistsAndFetches() throws {
        let context = ModelContext(try makeContainer())
        let enquiry = Enquiry(transcript: "t", name: "Asha Rao", phone: "+919876543210",
                              need: .office, brief: "b", step2Answers: ["preferredArea": "Koramangala"])
        context.insert(enquiry)
        try context.save()
        let fetched = try context.fetch(FetchDescriptor<Enquiry>())
        #expect(fetched.count == 1)
        #expect(fetched[0].name == "Asha Rao")
        #expect(fetched[0].need == .office)
        #expect(fetched[0].step2Answers["preferredArea"] == "Koramangala")
        #expect(fetched[0].status == .draft)
    }

    @Test func makePayloadRequiresNamePhoneNeed() {
        let incomplete = Enquiry(name: "", phone: "123", need: nil, brief: "b")
        #expect(incomplete.makePayload() == nil)

        let complete = Enquiry(name: "Asha Rao", phone: "98765 43210", need: .retail, brief: "b",
                               step2Answers: ["preferredLocality": "Indiranagar"])
        let payload = complete.makePayload()
        #expect(payload?.phone == "+919876543210")
        #expect(payload?.need == .retail)
        #expect(payload?.step2Answers?["preferredLocality"] == "Indiranagar")
    }

    @Test func emptyStep2AnswersBecomeNil() {
        let enquiry = Enquiry(name: "A", phone: "9876543210", need: .lease, brief: "b")
        #expect(enquiry.makePayload()?.step2Answers == nil)
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
- Produces: `EnquiryExtraction` (@Generable), `EnquiryDraft`, `EnquiryMapper.draft(from:)` / `.timelineBucket(_:)`, `TranscriptTrimmer.truncate(_:maxChars:)`. Consumed by Tasks 5, 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/EnquiryMapperTests.swift
import Foundation
import Testing
@testable import BrokerField

@Suite("Enquiry mapper")
struct EnquiryMapperTests {
    private func extraction(need: String? = nil, budget: String? = nil,
                            localities: [String] = [], timeline: String? = nil,
                            brief: String = "b") -> EnquiryExtraction {
        EnquiryExtraction(contactName: "Asha Rao", phone: "98765 43210", need: need,
                          budget: budget, localities: localities, timeline: timeline, brief: brief)
    }

    @Test func officeMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "office",
                                                         localities: ["Koramangala", "HSR"],
                                                         timeline: "next month"))
        #expect(draft.name == "Asha Rao")
        #expect(draft.need == .office)
        #expect(draft.step2Answers["preferredArea"] == "Koramangala, HSR")
        #expect(draft.step2Answers["moveInTimeline"] == "1\u{2013}3 months")
    }

    @Test func retailMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "retail",
                                                         localities: ["Indiranagar"],
                                                         timeline: "immediate"))
        #expect(draft.need == .retail)
        #expect(draft.step2Answers["preferredLocality"] == "Indiranagar")
        #expect(draft.step2Answers["timeline"] == "Immediate (this month)")
    }

    @Test func leaseFoldsBudgetAndTimeline() {
        let draft = EnquiryMapper.draft(from: extraction(need: "lease", budget: "Rs 80/sqft",
                                                         localities: ["Whitefield"], timeline: "immediate"))
        #expect(draft.need == .lease)
        #expect(draft.step2Answers["location"] == "Whitefield")
        #expect(draft.step2Answers["expectedRentTimeline"] == "Rs 80/sqft, immediate")
    }

    @Test func leaseInferenceWinsOverOfficeMention() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Client wants to lease out my property, an office floor"))
        #expect(draft.need == .lease)
    }

    @Test func retailInferenceFromKeywords() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Looking for a showroom with high-street frontage"))
        #expect(draft.need == .retail)
    }

    @Test func workshopDoesNotMatchShop() {
        // Word-boundary regression: "workshop" must not trigger the "shop" keyword.
        let draft = EnquiryMapper.draft(from: extraction(brief: "Needs a workshop space for light assembly"))
        #expect(draft.need != .retail)
    }

    @Test func unknownNeedStaysNil() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Exploring the market"))
        #expect(draft.need == nil)
        #expect(draft.step2Answers.isEmpty)
    }

    @Test(arguments: [
        ("asap", "Immediate (this month)"),
        ("in 2 months", "1\u{2013}3 months"),
        ("3-6 months", "3\u{2013}6 months"),
        ("just exploring", "Just exploring"),
    ])
    func timelineBuckets(input: String, expected: String) {
        #expect(EnquiryMapper.timelineBucket(input) == expected)
    }

    @Test func unmatchedTimelineIsNil() {
        #expect(EnquiryMapper.timelineBucket("someday") == nil)
        #expect(EnquiryMapper.timelineBucket(nil) == nil)
    }
}
```

```swift
// BrokerFieldTests/TranscriptTrimmerTests.swift
import Foundation
import Testing
@testable import BrokerField

@Suite("Transcript trimmer")
struct TranscriptTrimmerTests {
    @Test func shortTranscriptPassesThrough() {
        let result = TranscriptTrimmer.truncate("hello", maxChars: 100)
        #expect(result.text == "hello")
        #expect(!result.wasTruncated)
    }

    @Test func longTranscriptIsMarked() {
        let long = String(repeating: "a", count: 500)
        let result = TranscriptTrimmer.truncate(long, maxChars: 100)
        #expect(result.wasTruncated)
        #expect(result.text.hasPrefix(String(repeating: "a", count: 100)))
        #expect(result.text.contains("truncated"))
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
    /// Enhancement path (not v0.1): iOS 26.4+ exposes context-size/token-count
    /// APIs on the session — swap this heuristic for a measured budget then.
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
        // Order matters: "lease out my property" often also mentions office space.
        // Word-boundary matching so "workshop" doesn't trip "shop".
        if containsAny(haystack, ["lease out", "rent out", "my property", "landlord"]) {
            return .lease
        }
        if containsAny(haystack, ["retail", "showroom", "frontage", "high street", "high-street", "shop"]) {
            return .retail
        }
        if containsAny(haystack, ["office", "desk", "seat", "cowork", "workspace"]) {
            return .office
        }
        return nil
    }

    private static func containsAny(_ text: String, _ keywords: [String]) -> Bool {
        keywords.contains { keyword in
            text.range(of: "\\b\(NSRegularExpression.escapedPattern(for: keyword))\\b",
                       options: [.regularExpression, .caseInsensitive]) != nil
        }
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

Expected: `** TEST SUCCEEDED **` — mapper 9 tests + trimmer 2 tests, 0 failures.

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
- Produces: `EnquiryExtracting` protocol (`availability()`, `extract(from:)`, `prewarm()`), `ExtractorAvailability`, `ExtractionError` (incl. `.refusal`), `MockExtractor`, `FoundationModelsExtractor`. Consumed by Tasks 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/ExtractorAvailabilityTests.swift
import Foundation
import FoundationModels
import Testing
@testable import BrokerField

@Suite("Extractor availability")
struct ExtractorAvailabilityTests {
    @Test func mapsFrameworkAvailability() {
        #expect(FoundationModelsExtractor.mapAvailability(.available) == .available)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.deviceNotEligible)) == .deviceNotEligible)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.appleIntelligenceNotEnabled)) == .appleIntelligenceOff)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.modelNotReady)) == .modelNotReady)
    }

    @Test func mockRecordsTranscript() async throws {
        let expected = EnquiryExtraction(contactName: "Asha Rao", brief: "b")
        let mock = MockExtractor(result: .success(expected))
        #expect(mock.availability() == .available)
        let result = try await mock.extract(from: "some transcript")
        #expect(result == expected)
        #expect(mock.lastTranscript == "some transcript")
    }

    @Test func mockCanFail() async {
        let mock = MockExtractor(result: .failure(ExtractionError.guardrailViolation))
        await #expect(throws: ExtractionError.guardrailViolation) {
            try await mock.extract(from: "x")
        }
    }

    @Test func mockPrewarmIsRecorded() async {
        let mock = MockExtractor(result: .success(EnquiryExtraction(brief: "b")))
        #expect(!mock.didPrewarm)
        await mock.prewarm()
        #expect(mock.didPrewarm)
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
    case refusal
    case contextOverflow
    case failed(String)
}

/// The model seam — the Swift analog of the web app's `aiProvider()` facade.
/// v0.1 has one implementation (on-device AFM); PCC or AFM 3 Core Advanced
/// slot in later without touching call sites.
public protocol EnquiryExtracting: Sendable {
    func availability() -> ExtractorAvailability
    /// Warms model assets before the user needs them (call from view appear).
    func prewarm() async
    func extract(from transcript: String) async throws -> EnquiryExtraction
}

/// Test double. Lock-guarded so Swift 6 strict concurrency stays happy.
public final class MockExtractor: EnquiryExtracting, @unchecked Sendable {
    public var stubbedAvailability: ExtractorAvailability
    public var stubbedResult: Result<EnquiryExtraction, Error>
    private let lock = NSLock()
    private var _lastTranscript: String?
    private var _didPrewarm = false

    public var lastTranscript: String? {
        lock.lock()
        defer { lock.unlock() }
        return _lastTranscript
    }

    public var didPrewarm: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _didPrewarm
    }

    public init(availability: ExtractorAvailability = .available,
                result: Result<EnquiryExtraction, Error>) {
        self.stubbedAvailability = availability
        self.stubbedResult = result
    }

    public func availability() -> ExtractorAvailability { stubbedAvailability }

    public func prewarm() async {
        lock.lock()
        _didPrewarm = true
        lock.unlock()
    }

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

/// On-device extraction via the system language model.
/// Forward-compat: iOS 27 renames `GenerationError` to `LanguageModelError`
/// (deprecated alias) — revisit the catch list when the deployment floor moves.
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

    /// Prewarms model assets via a throwaway session. Extraction itself uses a
    /// fresh session per call — sessions accumulate transcript context, and
    /// reusing one would eventually overflow the context window.
    public func prewarm() async {
        guard availability() == .available else { return }
        LanguageModelSession(instructions: Self.instructions).prewarm()
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
            case .refusal:
                throw ExtractionError.refusal
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

Expected: `** TEST SUCCEEDED **` — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add EnquiryExtracting seam with prewarming on-device FoundationModels extractor."
```

---

### Task 6: Recording + transcription services (SpeechAnalyzer)

**Files:**
- Create: `broker-field-ios/BrokerField/Recording/AudioRecording.swift`
- Create: `broker-field-ios/BrokerField/Recording/AudioRecorder.swift`
- Create: `broker-field-ios/BrokerField/Transcription/SpeechTranscribing.swift`
- Create: `broker-field-ios/BrokerField/Transcription/SpeechTranscriber.swift`
- Test: `broker-field-ios/BrokerFieldTests/RecordingServicesTests.swift`

**Interfaces:**
- Produces: `AudioRecording` protocol + `MockRecorder`, `SpeechTranscribing` protocol + `MockTranscriber`, `RecordingError`, `TranscriptionError`. Consumed by Tasks 9, 10.

**Why SpeechAnalyzer, not SFSpeechRecognizer:** iOS 26's `SpeechAnalyzer` + `SpeechTranscriber` is Apple's Swift-native replacement: on-device by design (no server path at all — the old API only made on-device opt-in), no ~1-minute session cap, results as `AsyncSequence`, and a downloadable long-form model via `AssetInventory`. Our deployment floor is iOS 26.0, so there is no back-deployment reason to keep the legacy API. (Custom-vocabulary biasing is the one legacy-only feature — not needed for v0.1.)

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/RecordingServicesTests.swift
import Foundation
import Testing
@testable import BrokerField

@Suite("Recording services")
struct RecordingServicesTests {
    @Test func mockRecorderLifecycle() async throws {
        let recorder = MockRecorder()
        #expect(await recorder.requestPermission())
        let url = try await recorder.startRecording()
        #expect(url.lastPathComponent.hasSuffix(".m4a"))
        #expect(await recorder.isRecording)
        let stopped = try await recorder.stopRecording()
        #expect(stopped == url)
        #expect(await !recorder.isRecording)
    }

    @Test func mockRecorderStopWithoutStartThrows() async {
        let recorder = MockRecorder()
        await #expect(throws: RecordingError.notRecording) {
            try await recorder.stopRecording()
        }
    }

    @Test func mockRecorderPermissionDenied() async {
        let recorder = MockRecorder(grantPermission: false)
        #expect(await !recorder.requestPermission())
    }

    @Test func mockTranscriberReturnsStubbedTranscript() async throws {
        let transcriber = MockTranscriber(transcript: "hello world")
        #expect(await transcriber.requestAuthorization())
        let text = try await transcriber.transcribe(url: URL(fileURLWithPath: "/tmp/x.m4a"))
        #expect(text == "hello world")
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
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: file, settings: settings)
            guard recorder.record() else { throw RecordingError.failedToStart }
            self.recorder = recorder
            self.currentURL = file
            self.isRecording = true
            return file
        } catch {
            // Never leave the audio session active on a failed start.
            try? session.setActive(false)
            if let error = error as? RecordingError { throw error }
            throw RecordingError.failedToStart
        }
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
    case modelNotInstalled
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
import AVFoundation
import Foundation
import Speech

/// File transcription via iOS 26 SpeechAnalyzer + SpeechTranscriber.
/// On-device by design (no server path), no ~1-minute cap, results as an
/// AsyncSequence. The locale model is downloaded once via AssetInventory.
public struct SpeechAnalyzerTranscriber: SpeechTranscribing {
    public init() {}

    /// Speech authorization is still required for SpeechAnalyzer modules.
    public func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    public func transcribe(url: URL) async throws -> String {
        let locale = try await Self.preferredSupportedLocale()
        let transcriber = SpeechTranscriber(locale: locale, preset: .offlineTranscription)
        try await Self.ensureModelInstalled(for: transcriber, locale: locale)

        // Read results concurrently with analysis; concatenate finalized text.
        async let transcription = transcriber.results
            .reduce(AttributedString()) { partial, result in partial + result.text }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let file = try AVAudioFile(forReading: url)
        if let lastSample = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
            await analyzer.cancelAndFinishNow()
        }

        let text = try await transcription
        await AssetInventory.deallocate(locale: locale)
        return String(text.characters)
    }

    /// en-IN first (broker speech is often code-mixed); en-US when unsupported.
    static func preferredSupportedLocale() async throws -> Locale {
        let supported = await SpeechTranscriber.supportedLocales
        if supported.contains(where: { $0.identifier == "en-IN" }) {
            return Locale(identifier: "en-IN")
        }
        if supported.contains(where: { $0.identifier == "en-US" }) {
            return Locale(identifier: "en-US")
        }
        throw TranscriptionError.localeUnavailable
    }

    /// Downloads the locale's on-device model on first use. Callers surface a
    /// "downloading speech model" state — first run can take noticeable time.
    static func ensureModelInstalled(for transcriber: SpeechTranscriber, locale: Locale) async throws {
        let installed = await SpeechTranscriber.installedLocales
        guard !installed.contains(where: { $0.identifier == locale.identifier }) else { return }
        guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) else {
            throw TranscriptionError.modelNotInstalled
        }
        try await request.downloadAndInstall()
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 4 tests, 0 failures. (The real `SpeechAnalyzerTranscriber` is device-gated — simulator coverage comes from the mocks; on-device validation is the Task 11 checklist.)

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add recording service and SpeechAnalyzer-based file transcription with mocks."
```

---

### Task 7: Lead submitter (POST /api/leads)

**Files:**
- Create: `broker-field-ios/BrokerField/Sync/APIConfig.swift`
- Create: `broker-field-ios/BrokerField/Sync/LeadSubmitting.swift`
- Create: `broker-field-ios/BrokerField/Sync/LeadSubmitter.swift`
- Test: `broker-field-ios/BrokerFieldTests/StubURLProtocol.swift`
- Test: `broker-field-ios/BrokerFieldTests/LeadSubmitterTests.swift`

**Interfaces:**
- Consumes: `LeadPayload` (Task 2).
- Produces: `LeadSubmitting` protocol, `LeadSubmissionResult(enquiryId:tier:)`, `SubmitError`, `MockSubmitter`, `LeadSubmitter`, `APIConfig.baseURL`. Consumed by Tasks 8, 9, 10.

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

extension URLRequest {
    /// `httpBody` is nil when URLSession streams the body — read the stream.
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

```swift
// BrokerFieldTests/LeadSubmitterTests.swift
import Foundation
import Testing
@testable import BrokerField

@Suite("Lead submitter")
struct LeadSubmitterTests {
    private let baseURL = URL(string: "http://test.local")!
    private let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                      brief: "15 seats", step2Answers: ["preferredArea": "Koramangala"])

    @Test func successDecodesTierAndId() async throws {
        StubURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/leads")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
            let body = try JSONDecoder().decode(LeadPayload.self, from: request.httpBodyData!)
            #expect(body.name == "Asha Rao")
            #expect(body.need == .office)
            let json = #"{"ok":true,"crm":"pending","tier":"hot","enquiryId":"srv-1"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, json)
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        let result = try await submitter.submit(payload)
        #expect(result == LeadSubmissionResult(enquiryId: "srv-1", tier: "hot"))
    }

    @Test func clientErrorCarriesServerMessage() async {
        StubURLProtocol.handler = { request in
            let json = #"{"error":"invalid body"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil)!, json)
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await #expect(throws: SubmitError.client("invalid body")) {
            try await submitter.submit(payload)
        }
    }

    @Test func serverErrorCarriesStatus() async {
        StubURLProtocol.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data())
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await #expect(throws: SubmitError.server(500)) {
            try await submitter.submit(payload)
        }
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
    /// exception from Info.plist. HTTP cleartext + PII = dogfood only.
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

### Task 8: Outbox + backoff

**Files:**
- Create: `broker-field-ios/BrokerField/Sync/Outbox.swift`
- Test: `broker-field-ios/BrokerFieldTests/OutboxTests.swift`

**Interfaces:**
- Consumes: `Enquiry` (Task 3), `LeadSubmitting`/`MockSubmitter`/`SubmitError` (Task 7).
- Produces: `Outbox` actor (`processPending(now:)`), `BackoffPolicy.nextAttemptDate(after:from:)`. Consumed by Tasks 9, 10.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/OutboxTests.swift
import Foundation
import SwiftData
import Testing
@testable import BrokerField

@Suite("Outbox")
struct OutboxTests {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    @discardableResult
    private func seedQueued(in context: ModelContext, attemptCount: Int = 0,
                            nextAttemptAt: Date? = nil) -> Enquiry {
        let enquiry = Enquiry(name: "Asha Rao", phone: "9876543210", need: .office, brief: "b")
        enquiry.status = .queued
        enquiry.attemptCount = attemptCount
        enquiry.nextAttemptAt = nextAttemptAt
        context.insert(enquiry)
        try! context.save()
        return enquiry
    }

    @Test func backoffSchedule() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(BackoffPolicy.nextAttemptDate(after: 0, from: now) == now)
        #expect(BackoffPolicy.nextAttemptDate(after: 1, from: now) == now.addingTimeInterval(30))
        #expect(BackoffPolicy.nextAttemptDate(after: 2, from: now) == now.addingTimeInterval(120))
        #expect(BackoffPolicy.nextAttemptDate(after: 4, from: now) == now.addingTimeInterval(1800))
        #expect(BackoffPolicy.nextAttemptDate(after: 5, from: now) == nil)
    }

    @MainActor
    @Test func successfulSubmitMarksSubmitted() async throws {
        let container = try makeContainer()
        let enquiry = seedQueued(in: ModelContext(container))
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: "srv-1", tier: "warm"))))
        await outbox.processPending()
        #expect(enquiry.status == .submitted)
        #expect(enquiry.serverEnquiryId == "srv-1")
        #expect(enquiry.serverTier == "warm")
        #expect(enquiry.lastError == nil)
    }

    @MainActor
    @Test func failureSchedulesNextAttempt() async throws {
        let container = try makeContainer()
        let now = Date()
        let enquiry = seedQueued(in: ModelContext(container), nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.server(500))))
        await outbox.processPending(now: now)
        #expect(enquiry.status == .queued)
        #expect(enquiry.attemptCount == 1)
        #expect(enquiry.nextAttemptAt == now.addingTimeInterval(30))
        #expect(enquiry.lastError != nil)
    }

    @MainActor
    @Test func futureAttemptIsSkipped() async throws {
        let container = try makeContainer()
        let enquiry = seedQueued(in: ModelContext(container),
                                 nextAttemptAt: Date().addingTimeInterval(3600))
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        #expect(enquiry.status == .queued)
        #expect(enquiry.attemptCount == 0)
    }

    @MainActor
    @Test func maxAttemptsMarksFailed() async throws {
        let container = try makeContainer()
        let now = Date()
        let enquiry = seedQueued(in: ModelContext(container), attemptCount: 4, nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.transport)))
        await outbox.processPending(now: now)
        #expect(enquiry.status == .failed)
        #expect(enquiry.attemptCount == 5)
        #expect(enquiry.nextAttemptAt == nil)
    }

    @MainActor
    @Test func incompleteEnquiryFailsWithoutNetwork() async throws {
        let container = try makeContainer()
        let context = ModelContext(container)
        let enquiry = Enquiry(name: "", phone: "", need: nil, brief: "b")
        enquiry.status = .queued
        context.insert(enquiry)
        try context.save()
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        #expect(enquiry.status == .failed)
        #expect(enquiry.lastError == "incomplete enquiry")
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

### Task 9: RecordingSession orchestrator

**Files:**
- Create: `broker-field-ios/BrokerField/Session/RecordingSession.swift`
- Test: `broker-field-ios/BrokerFieldTests/RecordingSessionTests.swift`

**Interfaces:**
- Consumes: `AudioRecording`/`MockRecorder`, `SpeechTranscribing`/`MockTranscriber` (Task 6); `EnquiryExtracting`/`MockExtractor` (Task 5); `EnquiryMapper`, `EnquiryDraft`, `TranscriptTrimmer` (Task 4); `Enquiry` (Task 3); `Outbox`, `MockSubmitter`, `SubmitError` (Tasks 7–8).
- Produces: `RecordingSession` (@MainActor @Observable) with `state`, `transcript`, `notice`, `wasTruncated`, `extractorAvailable`, `prewarm()`, `startRecording()`, `stopAndProcess()`, `submit(draft:)`, `reset()`. Consumed by Task 10 UI.

- [ ] **Step 1: Write the failing tests**

```swift
// BrokerFieldTests/RecordingSessionTests.swift
import Foundation
import SwiftData
import Testing
@testable import BrokerField

@MainActor
@Suite("Recording session")
struct RecordingSessionTests {
    private let transcript = "Asha Rao, 98765 43210, needs a 15-seat office in Koramangala."

    private func makeSession(
        recorder: MockRecorder = MockRecorder(),
        transcriber: MockTranscriber? = nil,
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
                                       transcriber: transcriber ?? MockTranscriber(transcript: transcript),
                                       extractor: extractor,
                                       outbox: outbox,
                                       container: container)
        return (session, container)
    }

    @Test func micPermissionDeniedFailsWithCopy() async throws {
        let (session, _) = try makeSession(recorder: MockRecorder(grantPermission: false))
        await session.startRecording()
        guard case .failed(let message) = session.state else {
            Issue.record("expected failed, got \(session.state)")
            return
        }
        #expect(message.contains("Microphone"))
    }

    @Test func stopAndProcessProducesMappedDraft() async throws {
        let (session, _) = try makeSession()
        await session.startRecording()
        #expect(session.state == .recording)
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.name == "Asha Rao")
        #expect(draft.need == .office)
        #expect(draft.step2Answers["preferredArea"] == "Koramangala")
        #expect(session.transcript == transcript)
        #expect(session.notice == nil)
    }

    @Test func speechAuthorizationDeniedDegradesWithNotice() async throws {
        let (session, _) = try makeSession(
            transcriber: MockTranscriber(transcript: "", grantAuthorization: false))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief.isEmpty)
        #expect(session.notice?.contains("Speech") == true)
    }

    @Test func extractorUnavailableFallsBackToManualDraft() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief == transcript)
        #expect(draft.need == nil)
    }

    @Test(arguments: [ExtractionError.guardrailViolation, .refusal, .contextOverflow])
    func modelRefusalPathsFallBackWithNotice(error: ExtractionError) async throws {
        let (session, _) = try makeSession(extractorResult: .failure(error))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief == transcript)
        #expect(session.notice != nil)
    }

    @Test func submitWithoutNeedFails() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        await session.submit(draft: EnquiryDraft(name: "Asha Rao", phone: "9876543210"))
        guard case .failed(let message) = session.state else {
            Issue.record("expected failed, got \(session.state)")
            return
        }
        #expect(message.contains("Office"))
    }

    @Test func submitPersistsLocallyThenSubmits() async throws {
        let (session, container) = try makeSession()
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        await session.submit(draft: draft)
        guard case .submitted(let tier) = session.state else {
            Issue.record("expected submitted, got \(session.state)")
            return
        }
        #expect(tier == "hot")
        let stored = try ModelContext(container).fetch(FetchDescriptor<Enquiry>())
        #expect(stored.count == 1)
        #expect(stored[0].status == .submitted)
        #expect(stored[0].serverEnquiryId == "srv-1")
        #expect(stored[0].phone == "+919876543210")
    }

    @Test func submitOfflineQueues() async throws {
        let (session, container) = try makeSession(
            submitterResult: .failure(SubmitError.server(500)))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        await session.submit(draft: draft)
        #expect(session.state == .queuedOffline)
        let stored = try ModelContext(container).fetch(FetchDescriptor<Enquiry>())
        #expect(stored[0].status == .queued)
        #expect(stored[0].attemptCount == 1)
    }

    @Test func prewarmDelegatesToExtractor() async throws {
        let (session, _) = try makeSession()
        await session.prewarm()
        // No crash, no state change — the mock records it internally.
        #expect(session.state == .idle)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:BrokerFieldTests/RecordingSessionTests test CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

Expected: FAIL — `Cannot find 'RecordingSession' in scope`.

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
    /// Non-fatal degradation the review sheet should show (speech denied,
    /// model refusal fallback, truncation). Distinct from `state == .failed`.
    public private(set) var notice: String?
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

    /// Call from the record view's `.task` — warms model assets so the first
    /// extraction doesn't pay cold-start latency after the user stops recording.
    public func prewarm() async {
        await extractor.prewarm()
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
                notice = "Speech access is off — type the note below, or enable it in Settings."
                state = .ready(EnquiryDraft())
                return
            }
            let raw = try await transcriber.transcribe(url: url)
            let trimmed = TranscriptTrimmer.truncate(raw)
            transcript = trimmed.text
            wasTruncated = trimmed.wasTruncated
            if wasTruncated {
                notice = "Long note — only the first part was analysed."
            }
            if extractorAvailable {
                let extraction = try await extractor.extract(from: trimmed.text)
                state = .ready(EnquiryMapper.draft(from: extraction))
            } else {
                state = .ready(EnquiryDraft(brief: trimmed.text))
            }
        } catch ExtractionError.guardrailViolation, ExtractionError.refusal,
               ExtractionError.contextOverflow {
            // Model refused or overflowed — the transcript is still usable.
            notice = "Couldn't auto-fill the fields — review the transcript and type them in."
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
        notice = nil
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: `** TEST SUCCEEDED **` — 10 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add broker-field-ios && git commit -m "Add RecordingSession orchestrator (record → transcribe → extract → submit)."
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

- [ ] **Step 1: Write the failing UI test** (replaces the placeholder; waits for controls before tapping — mock permission/extraction are async)

```swift
// BrokerFieldUITests/BrokerFieldUITests.swift
import XCTest

final class BrokerFieldUITests: XCTestCase {
    @MainActor
    func testRecordReviewSubmitHappyPath() {
        let app = XCUIApplication()
        app.launchArguments = ["-UITesting"]
        app.launch()

        let recordButton = app.buttons["recordButton"]
        XCTAssertTrue(recordButton.waitForExistence(timeout: 10))
        recordButton.tap()

        let stopButton = app.buttons["stopButton"]
        XCTAssertTrue(stopButton.waitForExistence(timeout: 10))
        stopButton.tap()

        let nameField = app.textFields["nameField"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 15))
        XCTAssertEqual(nameField.value as? String, "Asha Rao")

        let submitButton = app.buttons["submitButton"]
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5))
        submitButton.tap()

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
        transcriber: SpeechAnalyzerTranscriber(),
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
        .task { await session.prewarm() }
        .onChange(of: session.state) { _, newState in
            if case .ready = newState { showingReview = true }
        }
        .sheet(isPresented: $showingReview, onDismiss: { session.reset() }) {
            if case .ready(let draft) = session.state {
                NavigationStack {
                    ReviewSheet(draft: draft, transcript: session.transcript,
                                notice: session.notice, session: session)
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
    let notice: String?
    let session: RecordingSession

    public init(draft: EnquiryDraft, transcript: String, notice: String?, session: RecordingSession) {
        _draft = State(initialValue: draft)
        self.transcript = transcript
        self.notice = notice
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
                bannerSection
                contactSection
                needSection
                briefSection
                transcriptSection
                submitSection
            }
        }
        .navigationTitle("Review enquiry")
    }

    /// Surfaces non-fatal degradation (speech denied, model fallback) and
    /// submission failures while the sheet is covering the record screen.
    @ViewBuilder
    private var bannerSection: some View {
        if let notice {
            Section {
                Label(notice, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("noticeLabel")
            }
        }
        if case .failed(let message) = session.state {
            Section {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("errorLabel")
            }
        }
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
                        Picker(field.label, selection: textBinding(for: field.key)) {
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
                    HStack {
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
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
        }
        .modelContainer(environment.container)
        // Flush queued enquiries on launch and every foreground — the spec's
        // "retry on foreground" half of the outbox contract.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await Outbox(container: environment.container,
                         submitter: environment.submitter).processPending()
        }
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

## Stack
- iOS 26+, iPhone, Swift 6, SwiftUI, SwiftData. Zero third-party dependencies.
- On-device transcription: SpeechAnalyzer + SpeechTranscriber (offline preset,
  en-IN with en-US fallback; model downloads once via AssetInventory).
- On-device extraction: FoundationModels `LanguageModelSession` + `@Generable`.
- Unit tests: Swift Testing. UI tests: XCTest/XCUI.

## Requirements
- Xcode 26+ (26.2 verified), iOS 26 simulator or device.
- On-device AI extraction needs an Apple Intelligence iPhone (15 Pro+).
  Without it the app still records, transcribes, and submits manually.

## Run
Open `BrokerField.xcodeproj`, pick the `BrokerField` scheme, run.
Backend base URL: `GSAPIBaseURL` in `Info.plist` (default: dogfood VM over
HTTP — dogfood only; HTTPS domain is a pre-production blocker).

## Test
```
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO
```

## Device checklist (manual gate)
- [ ] Apple Intelligence enabled; mic + speech permissions granted
- [ ] First transcription downloads the speech model (visible wait is expected)
- [ ] Record 30s code-mixed (English/Hindi) note → transcript sensible
- [ ] Extraction fills name/phone/need/localities; review edits work
- [ ] Airplane-mode submit → queued; foreground the app → outbox submits
- [ ] Enquiry visible in the ads-agent pipeline (via /api/leads → S5a)
```

- [ ] **Step 3: Commit**

```bash
git add broker-field-ios/README.md && git commit -m "Add Broker Field README with run/test/device checklist."
```

---

## Self-Review Notes (rev 2, 2026-09-18)

- **Spec coverage:** record (T6), transcribe (T6), extract + seam + degradation (T4/T5), review + submit (T9/T10), local-first + outbox (T3/T8), history + retry (T10), schema mapping (T2/T4), availability states (T5/T9/T10), foreground retry (T10 `scenePhase`), testing incl. UI + device gate (T10/T11). Milestones M2–M4 are spec-only by design.
- **Dependency order is linear:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. No forward references.
- **Audit-driven fixes baked in:** SpeechAnalyzer replaces SFSpeechRecognizer; Swift Testing replaces XCTest for units; `.refusal` caught; session prewarm; word-boundary keyword matching; UI test waits; review-sheet notice/error banners; audio session deactivated on failed start; dead `submittedPayloads` removed from `MockSubmitter`.
- **Known sharp edges flagged inline:** `httpBodyStream` in URLProtocol stubs (T7), en-dash characters in `TIMELINE_BUCKETS` (T2 uses `\u{2013}` escapes), first-run speech-model download latency (T6/T11), simulator cannot validate AFM/SpeechAnalyzer quality (device checklist in T11), HTTP+PII is dogfood-only (Global Constraints).
- **iOS 27 forward notes:** `LanguageModelError` replaces `GenerationError` (T5 comment); vision/PCC/`LanguageModel` protocol swaps arrive with the M3+ milestones via the `EnquiryExtracting` seam.
