#![no_std]

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

extern "C" {
    pub fn external_func();
}

#[no_mangle]
pub fn internal_func() {
    unsafe {
        external_func();
    }
}
