#include "wgc_session.h"

#include <Windows.Graphics.Capture.Interop.h>
#include <dxgi1_2.h>
#include <inspectable.h>
#include <winrt/base.h>

#include <iostream>

namespace wf = winrt::Windows::Foundation;
namespace wgcap = winrt::Windows::Graphics::Capture;
namespace wgdx = winrt::Windows::Graphics::DirectX;
namespace wgd3d = winrt::Windows::Graphics::DirectX::Direct3D11;

extern "C" HRESULT __stdcall CreateDirect3D11DeviceFromDXGIDevice(
    ::IDXGIDevice* dxgiDevice,
    ::IInspectable** graphicsDevice);

namespace {

bool succeeded(HRESULT hr, const char* label) {
    if (SUCCEEDED(hr)) {
        return true;
    }

    std::cerr << "ERROR: " << label << " failed (hr=0x" << std::hex << hr << std::dec << ")"
              << std::endl;
    return false;
}

Microsoft::WRL::ComPtr<IDXGIAdapter1> findAdapterForMonitor(HMONITOR monitor) {
    if (!monitor) {
        return nullptr;
    }

    Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(hr) || !factory) {
        std::cerr << "WARNING: CreateDXGIFactory1 failed while resolving monitor adapter (hr=0x"
                  << std::hex << hr << std::dec << ")" << std::endl;
        return nullptr;
    }

    for (UINT adapterIndex = 0;; ++adapterIndex) {
        Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
        hr = factory->EnumAdapters1(adapterIndex, adapter.GetAddressOf());
        if (hr == DXGI_ERROR_NOT_FOUND) {
            break;
        }
        if (FAILED(hr) || !adapter) {
            continue;
        }

        DXGI_ADAPTER_DESC1 adapterDesc{};
        if (SUCCEEDED(adapter->GetDesc1(&adapterDesc)) &&
            (adapterDesc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) {
            continue;
        }

        for (UINT outputIndex = 0;; ++outputIndex) {
            Microsoft::WRL::ComPtr<IDXGIOutput> output;
            hr = adapter->EnumOutputs(outputIndex, output.GetAddressOf());
            if (hr == DXGI_ERROR_NOT_FOUND) {
                break;
            }
            if (FAILED(hr) || !output) {
                continue;
            }

            DXGI_OUTPUT_DESC outputDesc{};
            if (SUCCEEDED(output->GetDesc(&outputDesc)) && outputDesc.Monitor == monitor) {
                std::cout << "{\"event\":\"display-adapter-resolved\",\"schemaVersion\":2,"
                          << "\"adapterIndex\":" << adapterIndex
                          << ",\"outputIndex\":" << outputIndex << "}" << std::endl;
                return adapter;
            }
        }
    }

    std::cerr << "WARNING: Could not resolve DXGI adapter for selected monitor; using default adapter"
              << std::endl;
    return nullptr;
}

int64_t timeSpanToHns(wf::TimeSpan const& value) {
    return value.count();
}

} // namespace

WgcSession::~WgcSession() {
    stop();
}

bool WgcSession::createD3DDevice(IDXGIAdapter* adapter) {
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#if defined(_DEBUG)
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_10_0,
    };
    D3D_FEATURE_LEVEL featureLevel{};

    HRESULT hr = D3D11CreateDevice(
        adapter,
        adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        flags,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        &featureLevel,
        &d3dContext_);

#if defined(_DEBUG)
    if (FAILED(hr)) {
        flags &= ~D3D11_CREATE_DEVICE_DEBUG;
        hr = D3D11CreateDevice(
            adapter,
            adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            flags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &d3dDevice_,
            &featureLevel,
            &d3dContext_);
    }
#endif

    if (FAILED(hr) && adapter) {
        std::cerr << "WARNING: D3D11CreateDevice failed for selected monitor adapter (hr=0x"
                  << std::hex << hr << std::dec << "); retrying default adapter" << std::endl;
        hr = D3D11CreateDevice(
            nullptr,
            D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            flags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &d3dDevice_,
            &featureLevel,
            &d3dContext_);
    }

    if (!succeeded(hr, "D3D11CreateDevice")) {
        return false;
    }

    Microsoft::WRL::ComPtr<IDXGIDevice> dxgiDevice;
    if (!succeeded(d3dDevice_.As(&dxgiDevice), "Query IDXGIDevice")) {
        return false;
    }

    winrt::com_ptr<::IInspectable> inspectableDevice;
    if (!succeeded(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectableDevice.put()),
                   "CreateDirect3D11DeviceFromDXGIDevice")) {
        return false;
    }

    winrtDevice_ = inspectableDevice.as<wgd3d::IDirect3DDevice>();
    return true;
}

bool WgcSession::createD3DDeviceForMonitor(HMONITOR monitor) {
    auto adapter = findAdapterForMonitor(monitor);
    return createD3DDevice(adapter.Get());
}

bool WgcSession::createCaptureItem(HMONITOR monitor) {
    auto factory = winrt::get_activation_factory<wgcap::GraphicsCaptureItem>();
    auto interop = factory.as<IGraphicsCaptureItemInterop>();

    wgcap::GraphicsCaptureItem item{nullptr};
    HRESULT hr = interop->CreateForMonitor(
        monitor,
        winrt::guid_of<wgcap::GraphicsCaptureItem>(),
        reinterpret_cast<void**>(winrt::put_abi(item)));
    if (!succeeded(hr, "CreateForMonitor")) {
        return false;
    }

    item_ = item;
    const auto size = item_.Size();
    width_ = static_cast<int>(size.Width);
    height_ = static_cast<int>(size.Height);
    return width_ > 0 && height_ > 0;
}

bool WgcSession::createCaptureItem(HWND window) {
    auto factory = winrt::get_activation_factory<wgcap::GraphicsCaptureItem>();
    auto interop = factory.as<IGraphicsCaptureItemInterop>();

    wgcap::GraphicsCaptureItem item{nullptr};
    HRESULT hr = interop->CreateForWindow(
        window,
        winrt::guid_of<wgcap::GraphicsCaptureItem>(),
        reinterpret_cast<void**>(winrt::put_abi(item)));
    if (!succeeded(hr, "CreateForWindow")) {
        return false;
    }

    item_ = item;
    const auto size = item_.Size();
    width_ = static_cast<int>(size.Width);
    height_ = static_cast<int>(size.Height);
    return width_ > 0 && height_ > 0;
}

bool WgcSession::applySessionOptions(bool captureCursor) {
    captureCursor_ = captureCursor;

    try {
        auto session2 = session_.try_as<wgcap::IGraphicsCaptureSession2>();
        if (!session2) {
            if (!captureCursor) {
                std::cerr << "ERROR: WGC cursor suppression is not supported by this Windows runtime"
                          << std::endl;
                return false;
            }
        } else {
            session2.IsCursorCaptureEnabled(captureCursor);
            const bool appliedCursorCapture = session2.IsCursorCaptureEnabled();
            std::cout << "{\"event\":\"cursor-capture\",\"schemaVersion\":2,\"requested\":"
                      << (captureCursor ? "true" : "false")
                      << ",\"applied\":" << (appliedCursorCapture ? "true" : "false") << "}"
                      << std::endl;

            if (appliedCursorCapture != captureCursor) {
                std::cerr << "ERROR: WGC cursor capture setting did not apply" << std::endl;
                return false;
            }
        }
    } catch (winrt::hresult_error const& error) {
        std::cerr << "ERROR: Failed to configure WGC cursor capture (hr=0x" << std::hex
                  << static_cast<uint32_t>(error.code()) << std::dec << ")" << std::endl;
        if (!captureCursor) {
            return false;
        }
    } catch (...) {
        std::cerr << "ERROR: Failed to configure WGC cursor capture" << std::endl;
        if (!captureCursor) {
            return false;
        }
    }

    try {
        session_.IsBorderRequired(false);
    } catch (...) {
        // IsBorderRequired is Windows 11-only. Ignore it on older builds.
    }

    return true;
}

bool WgcSession::initialize(HMONITOR monitor, int fps, bool captureCursor) {
    fps_ = fps > 0 ? fps : 60;
    if (!createD3DDeviceForMonitor(monitor)) {
        return false;
    }
    if (!createCaptureItem(monitor)) {
        return false;
    }

    framePool_ = wgcap::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        item_.Size());
    session_ = framePool_.CreateCaptureSession(item_);

    if (!applySessionOptions(captureCursor)) {
        return false;
    }

    frameArrivedToken_ = framePool_.FrameArrived({this, &WgcSession::onFrameArrived});
    return true;
}

bool WgcSession::initialize(HWND window, int fps, bool captureCursor) {
    fps_ = fps > 0 ? fps : 60;
    if (!createD3DDevice()) {
        return false;
    }
    if (!createCaptureItem(window)) {
        return false;
    }

    framePool_ = wgcap::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        item_.Size());
    session_ = framePool_.CreateCaptureSession(item_);

    if (!applySessionOptions(captureCursor)) {
        return false;
    }

    frameArrivedToken_ = framePool_.FrameArrived({this, &WgcSession::onFrameArrived});
    return true;
}

void WgcSession::setFrameCallback(FrameCallback callback) {
    std::scoped_lock lock(callbackMutex_);
    frameCallback_ = std::move(callback);
}

bool WgcSession::start() {
    if (!session_) {
        return false;
    }
    if (!applySessionOptions(captureCursor_)) {
        return false;
    }
    session_.StartCapture();
    started_ = true;
    return true;
}

void WgcSession::stop() {
    if (framePool_) {
        framePool_.FrameArrived(frameArrivedToken_);
    }
    if (session_) {
        session_.Close();
        session_ = nullptr;
    }
    if (framePool_) {
        framePool_.Close();
        framePool_ = nullptr;
    }
    item_ = nullptr;
    winrtDevice_ = nullptr;
    d3dContext_.Reset();
    d3dDevice_.Reset();
    started_ = false;
}

void WgcSession::onFrameArrived(
    wgcap::Direct3D11CaptureFramePool const& sender,
    wf::IInspectable const&) {
    auto frame = sender.TryGetNextFrame();
    if (!frame) {
        return;
    }

    auto surface = frame.Surface();
    auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
    HRESULT hr = access->GetInterface(__uuidof(ID3D11Texture2D), reinterpret_cast<void**>(texture.GetAddressOf()));
    if (FAILED(hr) || !texture) {
        return;
    }

    FrameCallback callback;
    {
        std::scoped_lock lock(callbackMutex_);
        callback = frameCallback_;
    }

    if (callback) {
        callback(texture.Get(), timeSpanToHns(frame.SystemRelativeTime()));
    }
    frame.Close();
}

int WgcSession::captureWidth() const {
    return width_;
}

int WgcSession::captureHeight() const {
    return height_;
}

ID3D11Device* WgcSession::device() const {
    return d3dDevice_.Get();
}

ID3D11DeviceContext* WgcSession::context() const {
    return d3dContext_.Get();
}
