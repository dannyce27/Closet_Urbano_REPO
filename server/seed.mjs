export const drops=[['001','After Hours',0],['002','Denim Files',Date.UTC(2027,0,15,2)]];
export const products=[
['CU-001','Racing Jacket','Chaquetas','L',4800,'Pecho 60 · Largo 68 cm','Muy buen estado','/img/p1.webp','001'],
['CU-002','Shadow Graphic Tee','Camisetas','M',2200,'Pecho 54 · Largo 70 cm','Desgaste vintage','/img/p2.webp','001'],
['CU-003','Baggy Denim','Pantalones','32',3600,'Cintura 82 · Largo 104 cm','Muy buen estado','/img/p3.webp','001'],
['CU-004','Ash Grey Hoodie','Sudaderas','L',3200,'Pecho 58 · Largo 69 cm','Buen estado','/img/p4.webp','001'],
['CU-005','Olive Cargo','Pantalones','30',3400,'Cintura 78 · Largo 101 cm','Muy buen estado','/img/p5.webp','001'],
['CU-006','Indigo Denim Jacket','Chaquetas','M',4200,'Pecho 55 · Largo 65 cm','Desgaste vintage','/img/p6.webp','002']];
export async function seed(db){
 await db.batch([...drops.map(x=>db.prepare('INSERT OR IGNORE INTO drops VALUES(?,?,?)').bind(...x)),...products.map(x=>db.prepare('INSERT OR IGNORE INTO products(id,name,category,size,price,measures,condition,image,drop_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(...x))]);
}
