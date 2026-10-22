#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <string>

static HHOOK g_keyboardHook = nullptr;
static DWORD g_mainThreadId = 0;
static std::atomic<bool> g_ctrlDown{false};
static std::mutex g_stdoutMutex;

static int64_t nowMs() {
    return static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count());
}

static void writeJsonLine(const std::string& json) {
    std::lock_guard<std::mutex> lock(g_stdoutMutex);
    std::cout << json << '\n';
    std::cout.flush();
}

static bool isCtrlKey(DWORD vkCode) {
    return vkCode == VK_CONTROL || vkCode == VK_LCONTROL || vkCode == VK_RCONTROL;
}

static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        const auto* event = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        if (event && isCtrlKey(event->vkCode)) {
            if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
                const bool wasDown = g_ctrlDown.exchange(true, std::memory_order_acq_rel);
                if (!wasDown) {
                    writeJsonLine(
                        "{\"event\":\"guide-hotkey\",\"key\":\"control\",\"state\":\"down\",\"timeMs\":" +
                        std::to_string(nowMs()) + "}");
                }
            } else if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {
                g_ctrlDown.store(false, std::memory_order_release);
            }
        }
    }

    return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
}

static BOOL WINAPI consoleCtrlHandler(DWORD signal) {
    if (
        signal == CTRL_C_EVENT ||
        signal == CTRL_BREAK_EVENT ||
        signal == CTRL_CLOSE_EVENT ||
        signal == CTRL_LOGOFF_EVENT ||
        signal == CTRL_SHUTDOWN_EVENT
    ) {
        PostThreadMessage(g_mainThreadId, WM_QUIT, 0, 0);
        return TRUE;
    }

    return FALSE;
}

int main() {
    g_mainThreadId = GetCurrentThreadId();
    SetConsoleCtrlHandler(consoleCtrlHandler, TRUE);

    g_keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
    if (!g_keyboardHook) {
        std::cerr << "Failed to install guide hotkey keyboard hook. error=" << GetLastError() << std::endl;
        return 1;
    }

    writeJsonLine("{\"event\":\"ready\"}");

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (g_keyboardHook) {
        UnhookWindowsHookEx(g_keyboardHook);
        g_keyboardHook = nullptr;
    }

    return 0;
}
