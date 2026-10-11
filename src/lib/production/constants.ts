/** Default terms of a custom production contract, naming the company (Settings → Company). */
export function defaultContractTermsAz(companyName: string): string {
  return `1. Bu müqavilə sifarişçi ilə ${companyName} arasında bağlanır.
2. Layihənin ümumi qiyməti, quraşdırma/çatdırılma haqqı və ödəniş şərtləri yuxarıda göstərilib.
3. Quraşdırma və çatdırılma razılaşdırılmış tarixdə həyata keçirilir.
4. Material və ölçü dəyişiklikləri yalnız tərəflərin yazılı razılığı ilə edilir.
5. Qalıq məbləğ layihənin təhvili zamanı ödənilir.
6. Seriya (stok) məhsulları bu müqaviləyə daxil deyil və pərakəndə satış fakturası ilə satılır.`;
}
