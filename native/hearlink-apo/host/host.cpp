// Standalone APO host for debugging: loads the APO DLL directly (no registry),
// drives the COM interfaces step by step, and reports where it fails.
// Build with /EHa so structured exception handling catches access violations.

#include <windows.h>
#include <cstdio>
#include <cstring>

#include "../apo.h"

// Same value as in apo.cpp; defined here so the host links without the DLL's object files.
const GUID CLSID_HearLinkApo = {
    0x8D3F1A2B, 0x5C4E, 0x4F60, {0x9B, 0x7A, 0x1E, 0x2D, 0x3C, 0x4B, 0x5A, 0x69}};

typedef HRESULT(__stdcall* DllGetClassObjectFn)(REFCLSID, REFIID, void**);
typedef HRESULT(__stdcall* DllCanUnloadNowFn)();

static void Report(const wchar_t* step, HRESULT hr) {
    wprintf(L"%-46s hr=0x%08X\n", step, static_cast<unsigned>(hr));
    fflush(stdout);
}

static void Step(const wchar_t* text) {
    wprintf(L"== %s\n", text);
    fflush(stdout);
}

int wmain(int argc, wchar_t** argv) {
    const wchar_t* dllPath = (argc > 1) ? argv[1] : L"HearLinkApo.dll";

    Step(L"加载 DLL");
    HMODULE module = LoadLibraryW(dllPath);
    if (module == nullptr) {
        wprintf(L"LoadLibrary 失败, GetLastError=%lu\n", GetLastError());
        return 1;
    }
    wprintf(L"模块句柄 = 0x%p\n", static_cast<void*>(module));

    DllGetClassObjectFn getClassObject =
        reinterpret_cast<DllGetClassObjectFn>(GetProcAddress(module, "DllGetClassObject"));
    if (getClassObject == nullptr) {
        wprintf(L"找不到 DllGetClassObject\n");
        return 1;
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    wprintf(L"CoInitializeEx hr=0x%08X\n", static_cast<unsigned>(hr));

    IClassFactory* factory = nullptr;
    Step(L"取类工厂");
    __try {
        hr = getClassObject(CLSID_HearLinkApo, IID_IClassFactory, reinterpret_cast<void**>(&factory));
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        wprintf(L"*** DllGetClassObject 触发访问违例 (0x%08X)\n", GetExceptionCode());
        return 2;
    }
    Report(L"DllGetClassObject", hr);
    if (FAILED(hr) || factory == nullptr) return 2;

    IAudioProcessingObject* apo = nullptr;
    Step(L"CreateInstance(IID_IAudioProcessingObject)");
    __try {
        hr = factory->CreateInstance(nullptr, __uuidof(IAudioProcessingObject),
                                     reinterpret_cast<void**>(&apo));
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        wprintf(L"*** CreateInstance 触发访问违例 (0x%08X)\n", GetExceptionCode());
        return 3;
    }
    Report(L"CreateInstance", hr);
    if (FAILED(hr) || apo == nullptr) return 3;

    Step(L"QueryInterface 各接口");
    IUnknown* unk = nullptr;
    __try { hr = apo->QueryInterface(IID_IUnknown, reinterpret_cast<void**>(&unk)); }
    __except (EXCEPTION_EXECUTE_HANDLER) { wprintf(L"*** QI(IUnknown) AV\n"); return 4; }
    Report(L"QI IUnknown", hr);
    if (unk) unk->Release();

    IAudioProcessingObjectRT* rt = nullptr;
    __try { hr = apo->QueryInterface(__uuidof(IAudioProcessingObjectRT), reinterpret_cast<void**>(&rt)); }
    __except (EXCEPTION_EXECUTE_HANDLER) { wprintf(L"*** QI(RT) AV\n"); return 4; }
    Report(L"QI IAudioProcessingObjectRT", hr);
    if (rt) rt->Release();

    IAudioProcessingObjectConfiguration* config = nullptr;
    __try { hr = apo->QueryInterface(__uuidof(IAudioProcessingObjectConfiguration), reinterpret_cast<void**>(&config)); }
    __except (EXCEPTION_EXECUTE_HANDLER) { wprintf(L"*** QI(Config) AV\n"); return 4; }
    Report(L"QI IAudioProcessingObjectConfiguration", hr);
    if (config) config->Release();

    Step(L"GetRegistrationProperties");
    APO_REG_PROPERTIES* props = nullptr;
    __try { hr = apo->GetRegistrationProperties(&props); }
    __except (EXCEPTION_EXECUTE_HANDLER) { wprintf(L"*** GetRegistrationProperties AV\n"); return 5; }
    Report(L"GetRegistrationProperties", hr);
    if (SUCCEEDED(hr) && props) {
        wprintf(L"   Flags=0x%X NumAPOInterfaces=%u MaxInstances=%u\n",
                static_cast<unsigned>(props->Flags), props->u32NumAPOInterfaces,
                props->u32MaxInstances);
        for (UINT32 i = 0; i < props->u32NumAPOInterfaces; ++i) {
            wchar_t guid[64] = {0};
            StringFromGUID2(props->iidAPOInterfaceList[i], guid, 64);
            wprintf(L"   APOInterface[%u]=%s\n", i, guid);
        }
    }

    Step(L"Initialize(APOInitBaseStruct)");
    struct SimpleInit {
        UINT32 cbSize;
        CLSID clsid;
    } init = {sizeof(SimpleInit), CLSID_HearLinkApo};
    __try {
        hr = apo->Initialize(sizeof(init), reinterpret_cast<BYTE*>(&init));
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        wprintf(L"*** Initialize 触发访问违例 (0x%08X)\n", GetExceptionCode());
        return 6;
    }
    Report(L"Initialize", hr);

    Step(L"GetLatency");
    HNSTIME latency = 0;
    __try { hr = apo->GetLatency(&latency); }
    __except (EXCEPTION_EXECUTE_HANDLER) { wprintf(L"*** GetLatency AV\n"); return 7; }
    Report(L"GetLatency", hr);
    wprintf(L"   latency=%lld (100ns)\n", static_cast<long long>(latency));

    factory->Release();
    if (SUCCEEDED(hr)) {
        wprintf(L"\n宿主完成：对象创建与初始化均正常。\n");
    } else {
        wprintf(L"\n宿主完成：Initialize 返回失败，需要修正初始化参数。\n");
    }
    CoUninitialize();
    return 0;
}
