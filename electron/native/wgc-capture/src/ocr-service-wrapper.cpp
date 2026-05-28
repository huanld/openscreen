#include <Windows.h>

#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr const wchar_t* SERVICE_NAME = L"OpenScreenOCR";

struct ServiceConfig {
    std::wstring exePath;
    std::wstring resourcesPath;
    std::wstring dataPath;
};

SERVICE_STATUS_HANDLE g_statusHandle = nullptr;
SERVICE_STATUS g_status{};
HANDLE g_stopEvent = nullptr;
PROCESS_INFORMATION g_childProcess{};
ServiceConfig g_config;

std::wstring quoteArg(const std::wstring& value) {
    std::wstring result = L"\"";
    for (wchar_t ch : value) {
        if (ch == L'"') {
            result += L"\\\"";
        } else {
            result.push_back(ch);
        }
    }
    result += L"\"";
    return result;
}

std::wstring directoryName(const std::wstring& path) {
    const size_t slash = path.find_last_of(L"\\/");
    return slash == std::wstring::npos ? L"." : path.substr(0, slash);
}

void createDirectoryRecursive(const std::wstring& path) {
    if (path.empty()) {
        return;
    }

    std::wstring current;
    for (size_t i = 0; i < path.size(); ++i) {
        current.push_back(path[i]);
        if (path[i] != L'\\' && path[i] != L'/') {
            continue;
        }
        if (current.size() > 3) {
            CreateDirectoryW(current.c_str(), nullptr);
        }
    }
    CreateDirectoryW(path.c_str(), nullptr);
}

void setEnv(const wchar_t* name, const std::wstring& value) {
    SetEnvironmentVariableW(name, value.empty() ? nullptr : value.c_str());
}

void setServiceStatus(DWORD state, DWORD win32ExitCode = NO_ERROR, DWORD waitHint = 0) {
    if (!g_statusHandle) {
        return;
    }

    g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    g_status.dwCurrentState = state;
    g_status.dwWin32ExitCode = win32ExitCode;
    g_status.dwWaitHint = waitHint;
    g_status.dwControlsAccepted =
        state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
    static DWORD checkpoint = 1;
    g_status.dwCheckPoint =
        state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING ? checkpoint++ : 0;
    SetServiceStatus(g_statusHandle, &g_status);
}

HANDLE openServiceLog(const std::wstring& dataPath) {
    const std::wstring logDir = dataPath + L"\\logs";
    createDirectoryRecursive(logDir);
    const std::wstring logPath = logDir + L"\\ocr-service.log";
    SECURITY_ATTRIBUTES securityAttributes{};
    securityAttributes.nLength = sizeof(securityAttributes);
    securityAttributes.bInheritHandle = TRUE;
    HANDLE file = CreateFileW(
        logPath.c_str(),
        FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        &securityAttributes,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (file != INVALID_HANDLE_VALUE) {
        SetFilePointer(file, 0, nullptr, FILE_END);
    }
    return file;
}

bool startOcrProcess(const ServiceConfig& config) {
    if (config.exePath.empty()) {
        return false;
    }

    const std::wstring dataPath = config.dataPath.empty()
        ? directoryName(config.exePath) + L"\\ocr-runtime"
        : config.dataPath;
    const std::wstring resourcesPath = config.resourcesPath.empty()
        ? directoryName(directoryName(config.exePath))
        : config.resourcesPath;
    const std::wstring modelCachePath = dataPath + L"\\ocr-models";
    const std::wstring paddlexCachePath = resourcesPath + L"\\ocr-models\\paddlex";

    createDirectoryRecursive(dataPath);
    createDirectoryRecursive(modelCachePath);

    setEnv(L"OPENSCREEN_OCR_HOST", L"127.0.0.1");
    setEnv(L"OPENSCREEN_OCR_PORT", L"8866");
    setEnv(L"PADDLEOCR_DEVICE", L"cpu");
    setEnv(L"PADDLEOCR_ENABLE_MKLDNN", L"0");
    setEnv(L"PADDLEOCR_LANG", L"");
    setEnv(L"PADDLEOCR_USE_MOBILE", L"1");
    setEnv(L"OPENSCREEN_OCR_PROFILE", L"vietnamese");
    setEnv(L"OPENSCREEN_OCR_WARMUP", L"1");
    setEnv(L"PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", L"False");
    setEnv(L"PADDLE_PDX_CACHE_HOME", paddlexCachePath);
    setEnv(L"PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", L"True");
    setEnv(L"PADDLE_HOME", modelCachePath + L"\\paddle");
    setEnv(L"PADDLEOCR_HOME", modelCachePath + L"\\paddleocr");
    setEnv(L"PYTHONUTF8", L"1");

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    HANDLE logFile = openServiceLog(dataPath);
    if (logFile != INVALID_HANDLE_VALUE) {
        startupInfo.dwFlags |= STARTF_USESTDHANDLES;
        startupInfo.hStdOutput = logFile;
        startupInfo.hStdError = logFile;
        startupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    }

    std::wstring commandLine = quoteArg(config.exePath);
    const std::wstring cwd = directoryName(config.exePath);
    ZeroMemory(&g_childProcess, sizeof(g_childProcess));
    const BOOL created = CreateProcessW(
        config.exePath.c_str(),
        commandLine.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_NO_WINDOW,
        nullptr,
        cwd.c_str(),
        &startupInfo,
        &g_childProcess);

    if (logFile != INVALID_HANDLE_VALUE) {
        CloseHandle(logFile);
    }
    return created == TRUE;
}

void stopOcrProcess() {
    if (g_childProcess.hProcess) {
        TerminateProcess(g_childProcess.hProcess, 0);
        WaitForSingleObject(g_childProcess.hProcess, 10000);
        CloseHandle(g_childProcess.hProcess);
        g_childProcess.hProcess = nullptr;
    }
    if (g_childProcess.hThread) {
        CloseHandle(g_childProcess.hThread);
        g_childProcess.hThread = nullptr;
    }
}

DWORD WINAPI serviceControlHandler(DWORD control, DWORD, LPVOID, LPVOID) {
    if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
        setServiceStatus(SERVICE_STOP_PENDING, NO_ERROR, 10000);
        if (g_stopEvent) {
            SetEvent(g_stopEvent);
        }
        stopOcrProcess();
        return NO_ERROR;
    }
    return NO_ERROR;
}

void WINAPI serviceMain(DWORD, LPWSTR*) {
    g_statusHandle = RegisterServiceCtrlHandlerExW(SERVICE_NAME, serviceControlHandler, nullptr);
    if (!g_statusHandle) {
        return;
    }

    setServiceStatus(SERVICE_START_PENDING, NO_ERROR, 30000);
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!g_stopEvent || !startOcrProcess(g_config)) {
        setServiceStatus(SERVICE_STOPPED, ERROR_SERVICE_SPECIFIC_ERROR);
        return;
    }

    setServiceStatus(SERVICE_RUNNING);
    HANDLE waitHandles[] = {g_stopEvent, g_childProcess.hProcess};
    WaitForMultipleObjects(2, waitHandles, FALSE, INFINITE);
    stopOcrProcess();
    if (g_stopEvent) {
        CloseHandle(g_stopEvent);
        g_stopEvent = nullptr;
    }
    setServiceStatus(SERVICE_STOPPED);
}

ServiceConfig parseConfig(int argc, wchar_t* argv[]) {
    ServiceConfig config;
    for (int i = 1; i < argc; ++i) {
        const std::wstring arg = argv[i];
        auto readNext = [&](std::wstring& target) {
            if (i + 1 < argc) {
                target = argv[++i];
            }
        };
        if (arg == L"--exe") {
            readNext(config.exePath);
        } else if (arg == L"--resources") {
            readNext(config.resourcesPath);
        } else if (arg == L"--data") {
            readNext(config.dataPath);
        }
    }
    return config;
}

bool hasServiceFlag(int argc, wchar_t* argv[]) {
    for (int i = 1; i < argc; ++i) {
        if (std::wstring(argv[i]) == L"--service") {
            return true;
        }
    }
    return false;
}

} // namespace

int wmain(int argc, wchar_t* argv[]) {
    g_config = parseConfig(argc, argv);

    if (hasServiceFlag(argc, argv)) {
        SERVICE_TABLE_ENTRYW serviceTable[] = {
            {const_cast<LPWSTR>(SERVICE_NAME), serviceMain},
            {nullptr, nullptr},
        };
        return StartServiceCtrlDispatcherW(serviceTable) ? 0 : 1;
    }

    if (!startOcrProcess(g_config)) {
        std::wcerr << L"Failed to start OCR service process." << std::endl;
        return 1;
    }
    WaitForSingleObject(g_childProcess.hProcess, INFINITE);
    stopOcrProcess();
    return 0;
}
