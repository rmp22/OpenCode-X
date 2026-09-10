import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { useKV } from "./kv"
import { createSimpleContext } from "./helper"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const kv = useKV()
    // KVProvider only renders children once kv.ready, so the persisted choice is readable here.
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      // An explicit --auto launch flag wins over the persisted choice.
      mode: args.auto || kv.get("permission_auto") === true ? "auto" : "normal",
    })
    const set = (mode: PermissionMode) => {
      setStore("mode", mode)
      kv.set("permission_auto", mode === "auto")
    }
    return {
      get mode() {
        return store.mode
      },
      set,
      toggle() {
        set(store.mode === "auto" ? "normal" : "auto")
      },
    }
  },
})
