#include "apo.h"

#include <new>

static LONG g_dllRefCount = 0;

class CHearLinkClassFactory : public IClassFactory {
public:
    CHearLinkClassFactory() : m_refCount(1) {}

    STDMETHODIMP QueryInterface(REFIID riid, void** ppvObject) override {
        if (ppvObject == nullptr) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppvObject = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        *ppvObject = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&m_refCount); }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG count = InterlockedDecrement(&m_refCount);
        if (count == 0) delete this;
        return count;
    }

    STDMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid, void** ppvObject) override {
        if (ppvObject == nullptr) return E_POINTER;
        *ppvObject = nullptr;

        OLECHAR text[64] = {0};
        StringFromGUID2(riid, text, 64);
        char narrow[80] = {0};
        WideCharToMultiByte(CP_ACP, 0, text, -1, narrow, sizeof(narrow), nullptr, nullptr);
        char message[160];
        sprintf_s(message, sizeof(message), "CreateInstance riid=%s", narrow);
        ApoLog(message);

        if (pUnkOuter != nullptr) return CLASS_E_NOAGGREGATION;

        CHearLinkApo* apo = new (std::nothrow) CHearLinkApo(pUnkOuter);
        sprintf_s(message, sizeof(message), "CreateInstance: 对象%s", apo ? "已创建" : "创建失败");
        ApoLog(message);
        if (apo == nullptr) return E_OUTOFMEMORY;

        HRESULT hr = apo->QueryInterface(riid, ppvObject);
        apo->Release();

        sprintf_s(message, sizeof(message), "CreateInstance hr=0x%08X", static_cast<unsigned>(hr));
        ApoLog(message);
        return hr;
    }

    STDMETHODIMP LockServer(BOOL lock) override {
        if (lock) g_dllRefCount++;
        else g_dllRefCount--;
        return S_OK;
    }

private:
    LONG m_refCount;
};

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID reserved) {
    UNREFERENCED_PARAMETER(module);
    UNREFERENCED_PARAMETER(reserved);

    switch (reason) {
        case DLL_PROCESS_ATTACH:
            ApoLog("DllMain: 已加载到音频引擎进程");
            break;
        case DLL_PROCESS_DETACH:
            ApoLog("DllMain: 已从音频引擎进程卸载");
            break;
        default:
            break;
    }
    return TRUE;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppvObject) {
    if (ppvObject == nullptr) return E_POINTER;
    *ppvObject = nullptr;

    OLECHAR cls[64] = {0};
    OLECHAR iid[64] = {0};
    StringFromGUID2(rclsid, cls, 64);
    StringFromGUID2(riid, iid, 64);
    char narrowCls[80] = {0};
    char narrowIid[80] = {0};
    WideCharToMultiByte(CP_ACP, 0, cls, -1, narrowCls, sizeof(narrowCls), nullptr, nullptr);
    WideCharToMultiByte(CP_ACP, 0, iid, -1, narrowIid, sizeof(narrowIid), nullptr, nullptr);

    char message[220];
    sprintf_s(message, sizeof(message), "DllGetClassObject clsid=%s riid=%s", narrowCls, narrowIid);
    ApoLog(message);

    if (!IsEqualCLSID(rclsid, CLSID_HearLinkApo)) return CLASS_E_CLASSNOTAVAILABLE;

    CHearLinkClassFactory* factory = new (std::nothrow) CHearLinkClassFactory();
    if (factory == nullptr) return E_OUTOFMEMORY;

    HRESULT hr = factory->QueryInterface(riid, ppvObject);
    factory->Release();

    sprintf_s(message, sizeof(message), "DllGetClassObject hr=0x%08X", static_cast<unsigned>(hr));
    ApoLog(message);
    return hr;
}

STDAPI DllCanUnloadNow(void) {
    return (g_dllRefCount == 0) ? S_OK : S_FALSE;
}
